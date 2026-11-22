import { useParams } from 'react-router-dom';
import { ScreenBack } from '@/components/back-line';
import { useAccount } from '@/lib/account';
import { isStrikeKind } from '@/lib/strike-conversations';
import { StrikeConversation } from '@/routes/strikes/strike-conversation';

/** /strikes/:kind/:id: a strike or a flag, and the conversation about it (20261120120000). */
export default function StrikePage() {
  const { kind, id } = useParams();
  const { isAdmin } = useAccount();

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-canvas">
      <div className="mx-auto flex w-full max-w-[640px] flex-col px-[18px] pt-2 pb-16">
        <ScreenBack />
        {isStrikeKind(kind) && id ? (
          <StrikeConversation key={`${kind}:${id}`} kind={kind} id={id} isAdmin={isAdmin} />
        ) : (
          <p className="text-[0.875rem] text-grey">There is no such strike.</p>
        )}
      </div>
    </div>
  );
}
