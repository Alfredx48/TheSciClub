import { Navigate } from 'react-router-dom';
import { BackLink } from '@/components/back-link';
import { useAccount } from '@/lib/account';
import { useOwnMember } from '@/lib/members';
import { useMyOrganizations } from '@/lib/organization-representatives';
import { OrganizationsSection } from '@/routes/admin/organizations-section';

export default function OrganizationManagementPage() {
  const account = useAccount();
  const { member, loading, error } = useOwnMember(account.userId);
  const own = useMyOrganizations(account.userId);
  if (
    account.status === 'loading' ||
    loading ||
    own.loading ||
    (account.status === 'member' && !member && !error)
  )
    return <p className="p-4 text-grey">Loading…</p>;
  if (error)
    return (
      <div className="p-4">
        <BackLink to="/me" label="Me" />
        <p role="alert" className="mt-3 text-destructive">
          {error}
        </p>
        <button
          type="button"
          className="min-h-[44px] text-emphasis underline"
          onClick={() => {
            window.location.reload();
          }}
        >
          Retry
        </button>
      </div>
    );
  if (account.status !== 'member' || (!account.isAdmin && member?.type !== 'organization'))
    return <Navigate to="/me" replace />;
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-[720px]">
        <BackLink to="/me" label="Me" />
        <OrganizationsSection
          administrator={account.isAdmin}
          memberId={account.userId}
          ids={own.ids}
        />
      </div>
    </div>
  );
}
