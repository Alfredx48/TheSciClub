import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AccountProblem } from '@/components/account-problem';
import { signOut, useAccount } from '@/lib/account';
import { APPLE_RETURN_PARAM, signInWithApple } from '@/lib/apple-sign-in';
import {
  CONFIRMED_PARAM,
  cleanEmail,
  isCloseTo,
  looksLikeEmail,
  MIN_PASSWORD,
  resendConfirmation,
  sendPasswordReset,
  signInWithEmail,
  signUpWithEmail,
  verifySignUpCode,
} from '@/lib/auth-email';
import { describeError } from '@/lib/describe-error';
import {
  keepPendingRegistration,
  pendingRegistration,
  registeredRecently,
} from '@/lib/event-audience';
import { useGoogleInBrowser } from '@/lib/google-in-browser';
import { googlePhotoUrl } from '@/lib/google-photo';
import {
  GOOGLE_NOT_SIGNED_IN,
  GOOGLE_RETURN_PARAM,
  signInWithGoogle,
  signInWithGoogleToken,
} from '@/lib/google-sign-in';
import {
  captureInviteToken,
  claimHeldInvite,
  forgetInviteToken,
  heldInviteDetails,
  heldInviteToken,
  INVITE_PARAM,
} from '@/lib/invite-token';
import { useJoiningIsOpen } from '@/lib/joining';
import { lastWayIn } from '@/lib/last-way-in';
import {
  type NativeResult,
  nativeWaysIn,
  signInWithAppleNatively,
  signInWithGoogleNatively,
} from '@/lib/native-sign-in';
import {
  hasPasskey,
  passkeyAutofill,
  passkeyAutofillAvailable,
  passkeyOfferSnoozed,
  passkeysAvailable,
  registerPasskey,
  signInWithPasskey,
  snoozePasskeyOffer,
  upgradeToPasskeyQuietly,
} from '@/lib/passkeys';
import { formatPhoneInput } from '@/lib/phone';
import {
  captureQrCode,
  claimHeldQrCode,
  fetchQrCodeDetails,
  forgetQrCode,
  QR_PARAM,
  type QrCodeDetails,
} from '@/lib/qr-codes';
import { useRedirectTap } from '@/lib/redirect-tap';
import {
  arrivalDestination,
  forgetDestination,
  holdDestination,
  signInDestination,
} from '@/lib/sign-in-destination';
import { isNative } from '@/lib/standalone';
import { getSupabase } from '@/lib/supabase';
import { agreeToTerms, hasAgreedToTerms } from '@/lib/terms';
import { AgreeStep } from '@/routes/onboarding/agree-step';
import { BlockedScreen } from '@/routes/onboarding/blocked';
import { LinkButton, PrimaryButton, Question, StepFrame, Sub } from '@/routes/onboarding/chrome';
import {
  awaitingEmail,
  type Credentials,
  forgetAwaiting,
  rememberAwaiting,
  useSignInOnceConfirmed,
} from '@/routes/onboarding/confirm-elsewhere';
import { nameFromMetadata } from '@/routes/onboarding/prefill';
import {
  forgetOnDevice,
  isResumable,
  savedProgress,
  saveOnDevice,
  saveToAccount,
} from '@/routes/onboarding/progress';
import {
  CheckEmailStep,
  emailWaits,
  ForgotStep,
  JoinStep,
  PasskeyOffer,
  SignInStep,
} from '@/routes/onboarding/sign-in-steps';
import {
  BirthdayStep,
  CityStep,
  InjuryStep,
  NameStep,
  PhoneForEventsStep,
  PhotoStep,
  UsernameStep,
} from '@/routes/onboarding/steps';
import { submitOnboarding } from '@/routes/onboarding/submit-onboarding';
import {
  COUNTED_STEPS,
  canAdvance,
  cityStepDeclined,
  INITIAL_ONBOARDING_DATA,
  injuryStepDeclined,
  type OnboardingData,
  type Step,
  stepNumber,
  withCityDeclined,
  withInjuryDeclined,
} from '@/routes/onboarding/types';
import { WelcomeScreen } from '@/routes/onboarding/welcome';

/**
 * Joining the club, and signing back in.
 *
 * The order is the security decision in this file. Nobody is told whether an
 * address is on the list until they have *proved* it is theirs: a check that
 * anybody can run against any address would disclose who has a spinal cord
 * injury. So whichever way in someone takes (email and password, once the
 * emailed link has confirmed it; Google; Apple; a passkey) they come out the
 * other side as a signed-in account, and only then does `afterSignIn` ask the
 * database whether that account is invited (my_invite_status) — after first
 * claiming the invite their emailed link carried (claim_invite), if it did.
 *
 * Leftover accounts are allowed: an uninvited address can make an account.
 * That is the cost of never saying, at sign-up, who is invited.
 */

/** `passkey` is after the profile is saved, before Home. */
type Phase = 'wizard' | 'blocked' | 'submitting' | 'passkey-check' | 'passkey';

/** Where the invite check is run from: the doors, before anybody is through. */
const DOORS: Step[] = ['welcome', 'signin', 'forgot', 'join', 'check-email'];

const RESEND_WAIT = 60;

/** How long the birthday is read back before the step goes on by itself. */
const BIRTHDAY_PAUSE_MS = 600;

export default function OnboardingPage() {
  const navigate = useNavigate();
  const account = useAccount();
  const [phase, setPhase] = useState<Phase>('wizard');
  // Just registered for a public event (src/lib/event-audience.ts): the
  // welcome page says so, and joining starts from what they typed.
  const [registered] = useState(pendingRegistration);
  // The welcome page's "You're on our list" only while it is news.
  const [onTheList] = useState(registeredRecently);
  const [data, setData] = useState<OnboardingData>(() =>
    registered
      ? {
          ...INITIAL_ONBOARDING_DATA,
          email: registered.email,
          displayName: registered.name,
          phone: formatPhoneInput(registered.phone),
        }
      : INITIAL_ONBOARDING_DATA,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [forgotSent, setForgotSent] = useState(false);
  const [resendLeft, setResendLeft] = useState(0);
  const [blockedEmail, setBlockedEmail] = useState<string | null>(null);
  // Refused at the join form (20261012040000): no account, so nothing to sign out of.
  const [blockedAtSignUp, setBlockedAtSignUp] = useState(false);
  // The account's Google photo, if any, for the photo step to offer.
  const [googlePhoto, setGooglePhoto] = useState<string | null>(null);

  const set = useCallback((patch: Partial<OnboardingData>) => {
    setData((d) => ({ ...d, ...patch }));
  }, []);

  const [params, setParams] = useSearchParams();
  // Where a shared link was going (the owner, 2026-10-28): from the address,
  // else kept on this device from an earlier visit, through an invite asked
  // for and the invite's own link.
  const [destination] = useState(() => {
    const fromAddress = signInDestination(params.toString());
    if (fromAddress !== '/home') holdDestination(fromAddress);
    return arrivalDestination(params.toString());
  });
  // In the club: on the way there now, so this device keeps it no longer.
  useEffect(() => {
    if (account.status === 'member') forgetDestination();
  }, [account.status]);

  // The invite link's token has to outlive this page (a confirmation email or
  // Google's round trip comes first), so it is kept the moment /join loads.
  const [invited] = useState(() => captureInviteToken(params.toString()) !== null);
  // An administrator's QR code (20261014020000), kept the same way: credit for
  // whoever joins from it, claimed once there is an account.
  const [heldCode] = useState(() => captureQrCode(params.toString()));
  const [cameByCode] = useState(() => params.has(QR_PARAM));
  // Who the code is from, for the join screen: "Alfred invited you", or, while
  // joining is closed, who to ask and their email. Null for a code that says
  // nothing (unknown, turned off, its maker no longer an administrator).
  const [fromCode, setFromCode] = useState<QrCodeDetails | null>(null);
  useEffect(() => {
    if (heldCode === null) return;
    void fetchQrCodeDetails(heldCode).then(setFromCode);
  }, [heldCode]);
  // Only what the doors say; the database decides who gets in.
  const joiningOpen = useJoiningIsOpen();
  // An invitation goes straight to joining: its link is the reason they came, and
  // the Welcome screen's "Join the club" would only ask what the link already said.
  // So does a scanned code: it was held up so that somebody would join.
  // Sent from an event's registration to one door (public-event/next-step.tsx).
  const door = (useLocation().state as { door?: unknown } | null)?.door;
  const [step, setStep] = useState<Step>(
    invited || cameByCode || door === 'join' ? 'join' : door === 'signin' ? 'signin' : 'welcome',
  );
  // What was just typed, so the link opened on another device lets this one in.
  const [awaiting, setAwaiting] = useState<Credentials | null>(null);
  useSignInOnceConfirmed(step === 'check-email' ? awaiting : null);
  // The address the invitation was sent to, once the club has said, for the Email field.
  const [inviteAddress, setInviteAddress] = useState<string | null>(null);
  useEffect(() => {
    if (!params.has(INVITE_PARAM) && !params.has(QR_PARAM)) return;
    // A link opened while this page is already up (the store app, by a
    // Universal Link) arrives here, not in the first render: keep it too.
    const linked = captureInviteToken(params.toString()) !== null && params.has(INVITE_PARAM);
    const coded = captureQrCode(params.toString()) !== null && params.has(QR_PARAM);
    if (linked || coded) setStep((now) => (DOORS.includes(now) ? 'join' : now));
    setParams(
      (p) => {
        p.delete(INVITE_PARAM);
        p.delete(QR_PARAM);
        return p;
      },
      { replace: true },
    );
  }, [params, setParams]);

  // Asked once, signed out, and only filled in when nothing has been typed yet: a
  // typo in the address is a confirmation email that goes nowhere. It stays a
  // suggestion: the Email field is theirs to change (Decision 3, any address works).
  const askedAddress = useRef(false);
  useEffect(() => {
    if (askedAddress.current || account.status !== 'signed-out' || heldInviteToken() === null) {
      return;
    }
    askedAddress.current = true;
    void heldInviteDetails().then((details) => {
      if (details === null) return;
      const { email: address, name, phone } = details;
      setInviteAddress(address);
      // Sent from an event's guest list (20261104000000): what they typed
      // when they registered, into whatever is still empty.
      setData((d) => ({
        ...d,
        email: d.email.trim() === '' ? address : d.email,
        displayName: d.displayName.trim() === '' && name ? name : d.displayName,
        phone: d.phone.trim() === '' && phone ? formatPhoneInput(phone) : d.phone,
      }));
      // Kept on the device as their registration would have been, so it
      // outlasts a round trip to Google or Apple, and the event opens once
      // they are in.
      if (details.eventId && !pendingRegistration()) {
        keepPendingRegistration({
          eventId: details.eventId,
          status: details.status ?? 'going',
          name: name ?? '',
          email: address,
          phone: phone ?? '',
        });
      }
    });
  }, [account.status]);

  // Somebody with a profile has no use for a held invite, or a held code.
  useEffect(() => {
    if (account.status === 'member' || account.status === 'suspended') {
      forgetInviteToken();
      forgetQrCode();
    }
  }, [account.status]);

  /**
   * Back from a round trip without getting in: Cancel at Google or Apple, or an
   * emailed link that has expired. Once, on the first answer about the account.
   */
  const handledReturn = useRef(false);
  useEffect(() => {
    if (handledReturn.current || account.status === 'loading') return;
    handledReturn.current = true;
    if (account.status !== 'signed-out') return;
    const google = params.get(GOOGLE_RETURN_PARAM) === 'signin';
    const apple = params.get(APPLE_RETURN_PARAM) === 'signin';
    const confirmed = params.get(CONFIRMED_PARAM) === '1';
    const expired = window.location.hash.includes('error_code=');
    if (!google && !apple && !confirmed && !expired) {
      // A refresh while waiting for the link: the address, not the password.
      const email = awaitingEmail();
      if (email === null) return;
      setData((d) => ({ ...d, email }));
      setStep('signin');
      setNotice('If you opened the link in the email, sign in to go on.');
      return;
    }
    setStep('signin');
    if (expired)
      setError('That link has expired or was already used. Sign in, or ask for a new one.');
    else if (google) setError('Google did not sign you in. Try again, or use your email.');
    else if (apple) setError('Apple did not sign you in. Try again, or use your email.');
    else setNotice('Your email is confirmed. Sign in to go on.');
    setParams(
      (p) => {
        for (const key of [GOOGLE_RETURN_PARAM, APPLE_RETURN_PARAM, CONFIRMED_PARAM]) p.delete(key);
        return p;
      },
      { replace: true },
    );
  }, [account.status, params, setParams]);

  /**
   * Signed in, with no member row: claim the invite the link carried, then ask
   * whether this account is invited. Run on each sign-in while the doors are
   * showing, whichever way it happened.
   */
  /** Where the wizard goes once "Before you join" is agreed. */
  const resumeAfterAgreeing = useRef<Step>('name');
  const afterSignIn = useCallback(async () => {
    setError(null);
    setNotice(null);
    setAwaiting(null);
    forgetAwaiting();
    const supabase = getSupabase();
    const claim = await claimHeldInvite();
    if (claim === 'failed') {
      setError('Could not check your invitation. Try again.');
      return;
    }
    // Credit only: nothing waits on it, and a failure is tried again next time.
    await claimHeldQrCode();
    const statusResult = await supabase.rpc('my_invite_status').single();
    if (statusResult.error) {
      setError(describeError(statusResult.error, 'Could not check whether you are on the list.'));
      return;
    }
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!(statusResult.data as { invited: boolean }).invited) {
      setBlockedEmail(user?.email ?? null);
      // For the request form: a name typed already, else Google's or Apple's.
      setData((d) =>
        d.displayName.trim() ? d : { ...d, displayName: nameFromMetadata(user?.user_metadata) },
      );
      setPhase('blocked');
      return;
    }
    // The name Google or Apple gave, only into an empty box.
    const given = nameFromMetadata(user?.user_metadata);
    // Offered on the photo step, never taken unasked.
    setGooglePhoto(googlePhotoUrl(user));
    // Where this account left off, on this device or another (progress.ts).
    const saved = user?.id ? await savedProgress(user.id) : null;
    setData((d) => {
      const resumed = { ...d, ...saved?.answers };
      return {
        ...resumed,
        displayName: resumed.displayName.trim() ? resumed.displayName : given,
      };
    });
    const resume: Step = saved && saved.step !== 'name' ? saved.step : 'name';
    // "Before you join" first, until this account has agreed to the current
    // terms (src/lib/terms.ts); then on to where it left off.
    if (!(await hasAgreedToTerms())) {
      resumeAfterAgreeing.current = resume;
      setStep('agree');
      return;
    }
    setStep(resume);
    if (resume !== 'name') setNotice('Welcome back. You are where you left off.');
  }, []);

  async function submitAgree() {
    setBusy(true);
    setError(null);
    const agreed = await agreeToTerms();
    setBusy(false);
    if (!agreed.ok) {
      setError(agreed.error);
      return;
    }
    const resume = resumeAfterAgreeing.current;
    setStep(resume);
    if (resume !== 'name') setNotice('Welcome back. You are where you left off.');
  }

  // Kept as it is typed on this device, and on the account each time the
  // wizard moves on, so leaving halfway costs nothing (progress.ts). Only a
  // signed-in account that is not yet a member has anything to keep.
  const keeping = account.status === 'signed-up' && account.userId !== null && phase === 'wizard';
  useEffect(() => {
    if (!keeping || !account.userId || !isResumable(step)) return;
    saveOnDevice(account.userId, step, data);
  }, [keeping, account.userId, step, data]);
  const latest = useRef(data);
  latest.current = data;
  useEffect(() => {
    if (!keeping || !isResumable(step)) return;
    void saveToAccount(step, latest.current);
  }, [keeping, step]);

  // The birthday goes on by itself once the year is typed (the owner,
  // 2026-10-15): the year is the last box, so a whole, adult date is done.
  // Only on typing the year, never on arriving with one already there, or
  // Back from the next step would bounce straight forward again. A moment's
  // wait shows the date read back first, and typing on cancels it.
  const yearOnArrival = useRef<string | null>(null);
  useEffect(() => {
    if (step !== 'birthday') {
      yearOnArrival.current = null;
      return;
    }
    if (yearOnArrival.current === null) {
      yearOnArrival.current = data.birthYear;
      return;
    }
    if (data.birthYear === yearOnArrival.current) return;
    if (data.birthYear.length !== 4 || !canAdvance('birthday', data)) return;
    const timer = window.setTimeout(() => {
      setNotice(null);
      setStep('injury');
    }, BIRTHDAY_PAUSE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [step, data]);

  const gateRan = useRef(false);
  useEffect(() => {
    if (account.status !== 'signed-up') {
      gateRan.current = false;
      return;
    }
    if (phase !== 'wizard' || !DOORS.includes(step) || gateRan.current) return;
    gateRan.current = true;
    setStep('checking');
    void afterSignIn();
  }, [account.status, phase, step, afterSignIn]);

  // The wait before the confirmation link can be asked for again.
  useEffect(() => {
    if (resendLeft <= 0) return;
    const timer = window.setTimeout(() => {
      setResendLeft((n) => n - 1);
    }, 1000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [resendLeft]);

  /** Google's widget picked an account; a session follows and the gate takes over. */
  async function signInWithToken(token: string, nonce: string) {
    setBusy(true);
    setError(null);
    const result = await signInWithGoogleToken(token, nonce).catch(() => ({
      ok: false as const,
      error: GOOGLE_NOT_SIGNED_IN,
    }));
    setBusy(false);
    if (!result.ok) setError(result.error);
  }

  // Not `busy`: the buttons must still work if Google's or Apple's page is closed.
  const goesOut = useRedirectTap();

  async function continueWithGoogle() {
    if (!goesOut()) return;
    setError(null);
    const result = await signInWithGoogle();
    // On success the page is already on its way to Google.
    if (!result.ok) setError(result.error);
  }

  // Each tap that leaves for Apple, for the button's circle (OpeningIcon).
  const [appleTaps, setAppleTaps] = useState(0);

  async function continueWithApple() {
    if (isNative()) return void continueNatively(signInWithAppleNatively);
    if (!goesOut()) return;
    setAppleTaps((n) => n + 1);
    setError(null);
    const result = await signInWithApple();
    if (!result.ok) setError(result.error);
  }

  /** The store app's own sheet; a session follows and the gate takes over. */
  async function continueNatively(signIn: () => Promise<NativeResult>) {
    setBusy(true);
    setError(null);
    const result = await signIn().catch(() => ({
      ok: false as const,
      error: 'You were not signed in. Try again, or use your email.',
    }));
    setBusy(false);
    if (!result.ok) {
      // A closed sheet says nothing.
      if (result.error) setError(result.error);
      return;
    }
    // Apple's name, given once, into an empty box.
    const { name } = result;
    if (name) setData((d) => (d.displayName.trim() ? d : { ...d, displayName: name }));
  }

  const [native] = useState(nativeWaysIn);

  // The email box waits behind a button, unless this device last used it, or
  // the address is already here (an invite's, or one typed before).
  const [emailOpen, setEmailOpen] = useState(
    () => !emailWaits(native) || lastWayIn() === 'email' || looksLikeEmail(data.email),
  );
  useEffect(() => {
    if (looksLikeEmail(data.email)) setEmailOpen(true);
  }, [data.email]);

  // While the email box is showing on Welcome back, a saved passkey is offered
  // in its suggestions; where the browser cannot, or it is not showing, the
  // button stands in.
  const [passkeyAutofillOn, setPasskeyAutofillOn] = useState(false);
  useEffect(() => {
    if (step !== 'signin' || !emailOpen) return;
    const controller = new AbortController();
    const gone = () => controller.signal.aborted;
    void passkeyAutofillAvailable().then(async (available) => {
      if (!available || gone()) return;
      setPasskeyAutofillOn(true);
      const result = await passkeyAutofill(controller.signal);
      if (gone() || result.ok) return;
      // No more suggestions, so the button stands in for them too.
      setPasskeyAutofillOn(false);
      if (result.error) setError(result.error);
    });
    return () => {
      controller.abort();
      setPasskeyAutofillOn(false);
    };
  }, [step, emailOpen]);

  async function continueWithPasskey() {
    setBusy(true);
    setError(null);
    const result = await signInWithPasskey();
    setBusy(false);
    if (!result.ok && result.error) setError(result.error);
  }

  // On an iPhone's Home Screen, Google goes by way of Chrome or Safari. Here
  // rather than on the button, so the sign-in is collected on any door.
  const googleInBrowser = useGoogleInBrowser();

  // Open while the Home Screen app waits on a Google sign-in, so its "Finish in
  // Chrome" is not hidden behind Apple.
  const othersOpen = emailOpen || googleInBrowser?.state.step === 'waiting';

  const ways = {
    busy,
    native,
    appleTaps,
    googleInBrowser,
    onGoogleNative: () => {
      void continueNatively(signInWithGoogleNatively);
    },
    onGoogleToken: (token: string, nonce: string) => {
      void signInWithToken(token, nonce);
    },
    onGoogleRedirect: () => {
      void continueWithGoogle();
    },
    onApple: () => {
      void continueWithApple();
    },
    onPasskey: () => {
      void continueWithPasskey();
    },
    passkeyAutofill: passkeyAutofillOn,
    othersOpen,
    onOthers: () => {
      setEmailOpen((open) => !open);
    },
  };

  async function submitSignIn() {
    setBusy(true);
    setError(null);
    // Signed in is announced before this resolves; held so the member
    // check below waits for the passkey question.
    const suggest = passkeysAvailable() && !passkeyOfferSnoozed();
    if (suggest) setPasskeyHold(true);
    const result = await signInWithEmail(data.email, data.password);
    setBusy(false);
    if (result.ok) {
      set({ password: '', passwordAgain: '' });
      if (suggest) void suggestPasskeyAfterPassword();
      return;
    }
    setPasskeyHold(false);
    if (result.unconfirmed) {
      setAwaiting({ email: data.email, password: data.password });
      rememberAwaiting(data.email);
      setStep('check-email');
      setNotice(result.error);
      return;
    }
    setError(result.error);
  }

  async function submitJoin() {
    setBusy(true);
    setError(null);
    const result = await signUpWithEmail(data.email, data.password);
    setBusy(false);
    if (!result.ok && result.notInvited) {
      set({ password: '', passwordAgain: '' });
      setBlockedEmail(cleanEmail(data.email));
      setBlockedAtSignUp(true);
      setPhase('blocked');
      return;
    }
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // No email to wait for: the session is here, and the gate takes over as
    // after a code.
    if (result.signedIn) {
      set({ password: '', passwordAgain: '' });
      return;
    }
    setAwaiting({ email: data.email, password: data.password });
    rememberAwaiting(data.email);
    set({ password: '', passwordAgain: '' });
    setResendLeft(RESEND_WAIT);
    setStep('check-email');
  }

  /** The emailed code: a session follows, and the gate takes over as after the link. */
  async function submitCode(code: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await verifySignUpCode(data.email, code);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAwaiting(null);
    forgetAwaiting();
  }

  async function submitForgot() {
    setBusy(true);
    setError(null);
    const result = await sendPasswordReset(data.email);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setForgotSent(true);
  }

  async function resend() {
    if (busy || resendLeft > 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await resendConfirmation(data.email);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setResendLeft(RESEND_WAIT);
    setNotice('Sent again. Look in spam if it does not arrive.');
  }

  /**
   * After a password, an account with no passkey gets one suggested: the
   * browser saves one quietly where it can, else "Sign in faster next
   * time?", not again for 30 days after Not now (the owner, 2026-10-27).
   */
  const [offerAfterSignIn, setOfferAfterSignIn] = useState(false);
  const [passkeyHold, setPasskeyHold] = useState(false);
  async function suggestPasskeyAfterPassword() {
    setPhase('passkey-check');
    try {
      if ((await hasPasskey()) !== false) return;
      if (await upgradeToPasskeyQuietly()) return;
      setOfferAfterSignIn(true);
      setPhase('passkey');
    } catch {
      // Not worth stopping a sign-in over: on to the club.
    } finally {
      setPhase((now) => (now === 'passkey-check' ? 'wizard' : now));
      setPasskeyHold(false);
    }
  }

  function leaveToPasskeyOrHome() {
    // Not for whoever joined with Google or Apple (the owner, 2026-11-03):
    // that is one tap already, and a passkey saves them nothing. Me → Sign-in
    // still has it.
    const way = lastWayIn();
    if (passkeysAvailable() && way !== 'google' && way !== 'apple') {
      setPhase('passkey');
      return;
    }
    void navigate(destination, { replace: true });
  }

  /**
   * `patch` is for "Skip for now", which must submit without the photograph
   * it skips. It used to `set` the file away and then call this, but this
   * reads `data` from the same render, so the file went up anyway.
   */
  async function finish(patch: Partial<OnboardingData> = {}) {
    setPhase('submitting');
    const result = await submitOnboarding({ ...data, ...patch });
    if (!result.ok) {
      setPhase('wizard');
      // A refused photograph is answered on the photo step, whichever
      // button finished: "Finish later" from the city carries a photograph
      // chosen and then gone back past. The file is let go, so the tile
      // shows "+" rather than a preview of something that is not stored.
      if (result.photoRefused) {
        set({ photoFile: null, photoPreviewUrl: null });
        setStep('photo');
      }
      if (result.usernameRefused) {
        set({ usernameChecked: '' });
        setStep('username');
      }
      setError(result.error ?? 'Could not finish signing up.');
      return;
    }
    if (account.userId) forgetOnDevice(account.userId);
    // No notifications question here (the owner, 2026-10-14): most people
    // join in a browser before they install the app, so asking now asks the
    // wrong place. The installed app asks once as it opens (AskOnOpening), and
    // Me → Settings has the switch.
    leaveToPasskeyOrHome();
  }

  if (account.status === 'error') return <AccountProblem account={account} />;

  // Before the check below: the row now exists, and should the account be
  // read again meanwhile, this screen must not vanish under a tap.
  if (phase === 'passkey-check') {
    return (
      <main className="grid h-dvh place-items-center bg-canvas">
        <Loader2 className="h-6 w-6 animate-spin text-grey" aria-label="Signing in…" />
      </main>
    );
  }
  if (phase === 'passkey') {
    // After a sign-in the account may not have finished joining, so the
    // usual checks below decide where to go; after joining, home.
    const leave = () => {
      if (offerAfterSignIn) setPhase('wizard');
      else void navigate(destination, { replace: true });
    };
    return (
      <PasskeyOffer
        busy={busy}
        error={error}
        onAdd={() => {
          setBusy(true);
          setError(null);
          void registerPasskey().then((result) => {
            setBusy(false);
            if (result.ok) leave();
            else if (result.error) setError(result.error);
          });
        }}
        onSkip={() => {
          snoozePasskeyOffer();
          leave();
        }}
      />
    );
  }

  // Somebody who already finished has no business being asked again.
  // 'suspended' comes here too. /profile and /profile/details live outside the
  // shell and send a non-member to /join, so without this a suspended member
  // bounced to the welcome screen — which invites them to join a club they are
  // already in. Sending them into the shell lands them on the screen that
  // explains the pause.
  if (account.status === 'suspended') return <Navigate to="/home" replace />;
  if (account.status === 'member' && !passkeyHold) {
    return <Navigate to={destination} replace />;
  }

  if (phase === 'blocked') {
    return (
      <BlockedScreen
        email={blockedEmail}
        name={data.displayName}
        signedIn={!blockedAtSignUp}
        fromCode={fromCode}
        onProved={() => {
          setBlockedEmail(null);
          setStep('checking');
          setPhase('wizard');
          void afterSignIn();
        }}
        onTryAnother={() => {
          if (blockedAtSignUp) {
            // The invite link, if any, stays held: it may still be good for the
            // address they try next.
            setBlockedAtSignUp(false);
            setBlockedEmail(null);
            set({ email: '' });
            setPhase('wizard');
            setStep('join');
            return;
          }
          void signOut().then(() => {
            forgetInviteToken();
            setPhase('wizard');
            setStep('signin');
            setBlockedEmail(null);
            set({ password: '', passwordAgain: '' });
          });
        }}
      />
    );
  }

  if (step === 'welcome') {
    return (
      <WelcomeScreen
        joiningOpen={joiningOpen}
        registered={onTheList ? registered : null}
        onJoin={() => {
          setStep('join');
        }}
        onSignIn={() => {
          setStep('signin');
        }}
      />
    );
  }

  const back: Record<Step, Step | undefined> = {
    welcome: undefined,
    signin: 'welcome',
    forgot: 'signin',
    join: 'welcome',
    'check-email': 'join',
    // No way back past a confirmed account: it already exists.
    checking: undefined,
    // Signs out, as Back from the first question does: see leaveForAnotherAccount.
    agree: undefined,
    // Back from the first question signs out, for another account: see
    // leaveForAnotherAccount.
    name: undefined,
    username: 'name',
    birthday: 'username',
    injury: 'birthday',
    city: 'injury',
    phone: 'city',
    photo: 'phone',
  };

  /**
   * Where the way out appears. The birthday included, once it is a valid one:
   * name, username and age are the answers a row cannot be written without, so
   * the moment all are in, the rest is optional and there is no reason to make
   * somebody click Continue first to be told so.
   *
   * Everything after them is nullable in the schema — `level_range` has a
   * 'Not sure yet' value, `exact_level`, `injury_date`, `city`, `state`, the
   * phone and the photograph are all optional — and Me is where they get
   * filled in. The phone step has its own, plainer, Skip.
   */
  const SKIPPABLE: Step[] = ['birthday', 'injury', 'city', 'photo'];

  /** The doors take an address, not a question's answer. */
  function doorReady(): boolean {
    if (step === 'signin') return looksLikeEmail(data.email) && data.password.length > 0;
    if (step === 'join')
      return (
        looksLikeEmail(data.email) &&
        data.password.length >= MIN_PASSWORD &&
        data.password === data.passwordAgain
      );
    if (step === 'forgot') return looksLikeEmail(data.email);
    if (step === 'checking') return error !== null;
    return false;
  }

  /**
   * Back from the first question (the owner, 2026-10-15): there is nothing
   * before it but the account itself, so Back signs out and opens the doors,
   * where somebody who used the wrong account chooses another. What they
   * typed stays saved for this account (progress.ts), should they come back.
   */
  function leaveForAnotherAccount() {
    setError(null);
    setNotice(null);
    void signOut().then(() => {
      setData(INITIAL_ONBOARDING_DATA);
      setStep('welcome');
    });
  }

  const n = stepNumber(step);
  const ready = DOORS.includes(step) || step === 'checking' ? doorReady() : canAdvance(step, data);
  const previous = back[step];
  const working = busy || phase === 'submitting';

  /** What finishing this step does. Shared by the button and by Enter. */
  function advance() {
    if (!ready || working) return;
    if (step === 'signin') return void submitSignIn();
    if (step === 'join') return void submitJoin();
    if (step === 'forgot') return void (forgotSent ? undefined : submitForgot());
    if (step === 'checking') {
      gateRan.current = false;
      return void afterSignIn();
    }
    if (step === 'agree') return void submitAgree();
    if (step === 'photo') return void finish();
    const order: Step[] = ['name', 'username', 'birthday', 'injury', 'city', 'phone', 'photo'];
    const next = order[order.indexOf(step) + 1];
    if (next) {
      setNotice(null);
      setStep(next);
    }
  }

  const primaryLabel =
    step === 'photo'
      ? 'Enter the club'
      : step === 'signin'
        ? 'Sign in'
        : step === 'join'
          ? 'Create account'
          : step === 'forgot'
            ? 'Send the link'
            : step === 'checking'
              ? 'Try again'
              : 'Continue';

  const showPrimary =
    step !== 'check-email' &&
    !((step === 'signin' || step === 'join') && !othersOpen) &&
    !(step === 'forgot' && forgotSent) &&
    !(step === 'checking' && !error);

  return (
    <StepFrame
      stepNumber={n}
      totalSteps={COUNTED_STEPS.length}
      onSubmit={advance}
      onBack={
        step === 'agree' || step === 'name'
          ? leaveForAnotherAccount
          : previous
            ? () => {
                setError(null);
                setNotice(null);
                setForgotSent(false);
                setStep(previous);
              }
            : undefined
      }
      footer={
        <>
          {error ? (
            <p role="alert" className="mb-2.5 text-[0.8125rem] text-destructive leading-[1.45]">
              {error}
            </p>
          ) : null}
          {notice && step !== 'signin' ? (
            <p role="status" className="mb-2.5 text-[0.8125rem] text-ink2 leading-[1.45]">
              {notice}
            </p>
          ) : null}
          {showPrimary ? (
            <PrimaryButton disabled={!ready || working}>
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : primaryLabel}
            </PrimaryButton>
          ) : null}
          {/* Once the birthday is in, everything left is optional — the
              schema says so — so the rest of the wizard is answerable later
              from Me.

              "Finish later" rather than "Skip for now" anywhere but the
              photo: it skips the remaining questions and enters the club, and
              "skip" on its own reads as skipping only the step in front of
              you. */}
          {/* On the birthday step only once the date is a real, adult one:
              skipping with nothing in it would write a row the database
              refuses, and the refusal would arrive as a sentence about a
              trigger. */}
          {/* "Rather not say" on the injury step, at the owner's request, and
              the same thing the survey offers on every screen: a decline is an
              answer, and a profile made of decisions is finished.
           *
           * It is not "Finish later" and the two have to stay apart. Finish
           * later abandons the whole of the rest of the wizard; this answers
           * this one page and goes on to the next.
           *
           * It declines the level and the date together, the way the survey
           * declines a screen. Complete-or-incomplete is not included: 'Do not
           * know' is already on that list as a real answer. */}
          {/* Declining moves straight on (the owner, 2026-10-01): it is an
              answer, and pressing Continue after it was a second press for
              the same thing. What was entered is cleared, so the row does not
              hold a level beside a decline of it. Back shows the tick, and
              pressing it again takes the decline back. */}
          {step === 'injury' ? (
            <LinkButton
              onClick={() => {
                const declining = !injuryStepDeclined(data);
                set({
                  declined: withInjuryDeclined(data, declining),
                  ...(declining
                    ? { exactLevel: null, injuryYear: '', injuryMonth: '', injuryDay: '' }
                    : {}),
                });
                if (declining) setStep('city');
              }}
            >
              {injuryStepDeclined(data) ? 'Rather not say ✓' : 'Rather not say'}
            </LinkButton>
          ) : null}
          {/* The same for where they live: both halves, as the details form
              declines them, and on to the phone. */}
          {step === 'city' ? (
            <LinkButton
              onClick={() => {
                const declining = !cityStepDeclined(data);
                set({
                  declined: withCityDeclined(data, declining),
                  ...(declining ? { city: '', state: '', zip: '' } : {}),
                });
                if (declining) setStep('phone');
              }}
            >
              {cityStepDeclined(data) ? 'Rather not say ✓' : 'Rather not say'}
            </LinkButton>
          ) : null}
          {step === 'phone' ? (
            <LinkButton
              onClick={() => {
                set({ phone: '' });
                setStep('photo');
              }}
            >
              Skip for now
            </LinkButton>
          ) : null}
          {SKIPPABLE.includes(step) && (step !== 'birthday' || ready) ? (
            <LinkButton
              onClick={() => {
                const skipped = step === 'photo' ? { photoFile: null, photoPreviewUrl: null } : {};
                set(skipped);
                void finish(skipped);
              }}
            >
              {step === 'photo' ? 'Skip for now' : 'Finish later — enter the club'}
            </LinkButton>
          ) : null}
          {/* Landing on the wrong door should not mean starting over. */}
          {step === 'signin' || step === 'join' ? (
            <LinkButton
              onClick={() => {
                setStep(step === 'join' ? 'signin' : 'join');
                setError(null);
                setNotice(null);
              }}
            >
              {step === 'signin' ? 'New here? Join the club' : 'Already a member? Sign in'}
            </LinkButton>
          ) : null}
          {step === 'forgot' && forgotSent ? (
            <LinkButton
              onClick={() => {
                setForgotSent(false);
                setStep('signin');
              }}
            >
              Back to sign in
            </LinkButton>
          ) : null}
        </>
      }
    >
      {step === 'signin' ? (
        <SignInStep
          data={data}
          set={set}
          ways={ways}
          notice={notice}
          onForgot={() => {
            setError(null);
            setStep('forgot');
          }}
        />
      ) : null}
      {step === 'forgot' ? <ForgotStep data={data} set={set} sent={forgotSent} /> : null}
      {step === 'join' ? (
        <JoinStep
          data={data}
          set={set}
          ways={ways}
          invited={invited || heldInviteToken() !== null}
          joiningOpen={joiningOpen}
          fromCode={fromCode}
          inviteAddress={
            inviteAddress !== null && cleanEmail(data.email) === inviteAddress
              ? inviteAddress
              : null
          }
          closeTo={
            inviteAddress !== null && isCloseTo(data.email, inviteAddress) ? inviteAddress : null
          }
        />
      ) : null}
      {step === 'check-email' ? (
        <CheckEmailStep
          email={cleanEmail(data.email)}
          secondsLeft={resendLeft}
          busy={busy}
          onResend={() => {
            void resend();
          }}
          onChangeAddress={() => {
            setError(null);
            setNotice(null);
            setAwaiting(null);
            forgetAwaiting();
            setStep('join');
          }}
          onCode={(code) => {
            void submitCode(code);
          }}
        />
      ) : null}
      {step === 'checking' ? (
        <>
          <Question>Checking your invitation</Question>
          <Sub>One moment.</Sub>
        </>
      ) : null}
      {step === 'agree' ? <AgreeStep /> : null}
      {step === 'name' ? <NameStep data={data} set={set} /> : null}
      {step === 'username' ? <UsernameStep data={data} set={set} /> : null}
      {step === 'birthday' ? <BirthdayStep data={data} set={set} /> : null}
      {step === 'injury' ? <InjuryStep data={data} set={set} /> : null}
      {step === 'city' ? <CityStep data={data} set={set} /> : null}
      {step === 'phone' ? <PhoneForEventsStep data={data} set={set} /> : null}
      {step === 'photo' ? (
        <PhotoStep
          data={data}
          googlePhotoUrl={googlePhoto}
          set={(patch) => {
            // Another photograph chosen after a refusal: the sentence was
            // about the last one.
            if ('photoFile' in patch) setError(null);
            set(patch);
          }}
        />
      ) : null}
    </StepFrame>
  );
}
