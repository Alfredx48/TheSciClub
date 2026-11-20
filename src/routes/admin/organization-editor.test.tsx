import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationEditor } from '@/routes/admin/organization-editor';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      rpc(name, args);
      return Promise.resolve({ data: 'made', error: null });
    },
  }),
}));

beforeEach(() => {
  rpc.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});

async function fillIn() {
  await userEvent.type(screen.getByLabelText('Organization name'), 'Rolling Hikers');
  await userEvent.type(screen.getByLabelText(/^Short code/), 'rh');
  await userEvent.selectOptions(screen.getByLabelText(/^Type/), 'outdoor');
}

describe('adding an organization', () => {
  it('recovers a member’s draft and sends it for approval, clearing the draft', async () => {
    const saved = vi.fn();
    function open(member = 'first') {
      return render(
        <OrganizationEditor
          organization={null}
          draftKey={`${member}:new-organization`}
          administrator={false}
          onSaved={saved}
          onCancel={vi.fn()}
        />,
      );
    }
    const first = open();
    expect(screen.getByText(/An administrator checks it/)).toBeInTheDocument();
    expect(screen.queryByText('Choose a logo')).not.toBeVisible();
    expect(screen.queryByLabelText('Can vouch for members')).toBeNull();
    await fillIn();
    const location = within(screen.getByRole('group', { name: 'Location 1 (main)' }));
    await userEvent.type(location.getByRole('combobox', { name: 'City' }), 'Oakland');
    await userEvent.selectOptions(location.getByRole('combobox', { name: 'State' }), 'CA');
    first.unmount();
    sessionStorage.clear();

    const other = open('second');
    expect(screen.getByLabelText('Organization name')).toHaveValue('');
    other.unmount();

    const restored = open();
    expect(screen.getByLabelText('Organization name')).toHaveValue('Rolling Hikers');
    expect(screen.getByRole('combobox', { name: 'City' })).toHaveValue('Oakland');
    await userEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    await waitFor(() => {
      expect(saved).toHaveBeenCalled();
    });
    expect(rpc).toHaveBeenCalledWith(
      'request_organization',
      expect.objectContaining({
        p_draft: expect.objectContaining({ name: 'Rolling Hikers', shortCode: 'RH' }) as unknown,
        p_places: [{ label: null, address: null, city: 'Oakland', state: 'CA', postalCode: null }],
      }),
    );
    expect(rpc).not.toHaveBeenCalledWith('save_organization', expect.anything());
    restored.unmount();
    open();
    expect(screen.getByLabelText('Organization name')).toHaveValue('');
  });

  it('saves an administrator’s straight away', async () => {
    const saved = vi.fn();
    render(
      <OrganizationEditor organization={null} administrator onSaved={saved} onCancel={vi.fn()} />,
    );
    await fillIn();
    await userEvent.click(screen.getByRole('button', { name: 'Save organization' }));
    await waitFor(() => {
      expect(saved).toHaveBeenCalled();
    });
    expect(rpc).toHaveBeenCalledWith('save_organization', expect.anything());
    expect(rpc).not.toHaveBeenCalledWith('request_organization', expect.anything());
  });
});
