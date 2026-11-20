import { useParams } from 'react-router-dom';
import { useAccount } from '@/lib/account';
import { isStrikeKind } from '@/lib/strike-conversations';
import { StrikeConversation } from '@/routes/strikes/strike-conversation';

/** /strikes/:kind/:id: a strike or a flag, and the conversation about it (20261120120000). */
export default function StrikePage() {
  const { kind, id } = useParams();
  const { isAdmin } = useAccount();

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-canvas">
      <div className="mx-auto w-full max-w-[640px] px-[18px] pt-6 pb-16">
        {isStrikeKind(kind) && id ? (
          <StrikeConversation key={`${kind}:${id}`} kind={kind} id={id} isAdmin={isAdmin} />
        ) : (
          <p className="text-[0.875rem] text-grey">There is no such strike.</p>
        )}
      </div>
    </div>
  );
}
