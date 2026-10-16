"use client";

import { useDashboardSession } from "../../ui/dashboard-shell";

export default function AccountPage() {
  const session = useDashboardSession();
  return (
    <section className="account-details" aria-label="Account details">
      <h2>Your profile</h2>
      <dl>
        <div>
          <dt>Name</dt>
          <dd>{session.user?.display_name}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{session.user?.email}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{session.current_role}</dd>
        </div>
      </dl>
      <h2>School</h2>
      <dl>
        <div>
          <dt>Name</dt>
          <dd>{session.current_school?.name}</dd>
        </div>
        <div>
          <dt>Timezone</dt>
          <dd>{session.current_school?.timezone}</dd>
        </div>
        <div>
          <dt>Language</dt>
          <dd>{session.current_school?.language}</dd>
        </div>
      </dl>
    </section>
  );
}
