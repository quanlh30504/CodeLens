import { RepositoryToggle } from '@/components/repository-toggle';
import type { Repository } from '@/lib/installation-states';

interface Props {
  repository: Repository;
  /** True for an owner of an active installation; otherwise the control is shown as unavailable. */
  canManage: boolean;
}

/**
 * One repository in the list: name, visibility, and its state. A repository GitHub no longer
 * reports stays in the list as "No longer accessible" so its history is not lost (FR-014), and it
 * has no enable control.
 */
export function RepositoryRow({ repository, canManage }: Props) {
  return (
    <tr>
      <td>{repository.fullName}</td>
      <td>{repository.private ? 'Private' : 'Public'}</td>
      <td>
        <RepositoryToggle repository={repository} canManage={canManage} />
      </td>
    </tr>
  );
}
