import { expect, type Page, test } from "@playwright/test";

async function noHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
}

async function openSection(page: Page, label: string, mobile: boolean) {
  if (mobile) await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page
    .getByRole("navigation", { name: "School sections" })
    .getByRole("link", { name: label, exact: true })
    .click();
}

test("public pages are responsive and login and signup are distinct", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "SchoolOS" })).toBeVisible();
  await expect(page.locator(".hero-photo")).toBeVisible();
  await page.locator(".product-image img").scrollIntoViewIfNeeded();
  await expect(page.locator(".product-image img")).toHaveJSProperty("complete", true);
  expect(
    await page
      .locator(".product-image img")
      .evaluate((element) => (element as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("landing.png"), fullPage: true });
  await page.getByRole("link", { name: "Login", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("example-password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("login.png"), fullPage: true });
  await page.getByRole("link", { name: "Create one" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByLabel("School name")).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("signup.png"), fullPage: true });
});

test("login, live overview, focused directory, page history and logout work", async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === "mobile";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/dashboard/students");
  await expect(page).toHaveURL(/\/login\?next=/);
  await page
    .getByLabel("Email", { exact: true })
    .fill(process.env.SCHOOLOS_TEST_EMAIL ?? "admin@schoolos.local");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.SCHOOLOS_TEST_PASSWORD ?? "schoolos-admin-demo");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/students$/);
  await expect(page.getByText("Setup loaded.")).toBeAttached();
  if (mobile) {
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Open menu", exact: true })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  }
  await expect(page.getByRole("heading", { name: "Student", exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Add student", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add student" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("students.png"), fullPage: true });
  const firstRecord = page.locator(".record-row").first();
  await expect(firstRecord).toBeVisible();
  await firstRecord.click();
  await expect(page.getByRole("heading", { name: "Student Profile" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Student timeline" })).toBeVisible();
  await page.getByRole("button", { name: "All students" }).click();
  await expect(firstRecord).toBeVisible();
  await openSection(page, "Overview", mobile);
  await expect(page.getByRole("heading", { name: "School overview", exact: true })).toBeVisible();
  await expect(page.getByText("Active students", { exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("dashboard.png"), fullPage: true });
  if (!mobile && process.env.SCHOOLOS_CAPTURE_PREVIEW === "1") {
    await page.screenshot({ path: "public/workspace-preview.png", fullPage: true });
  }
  await openSection(page, "Academics", mobile);
  await expect(page.getByRole("heading", { name: "Sections", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add section" })).toBeVisible();
  await page.getByRole("button", { name: "Add section" }).click();
  await expect(page.getByRole("dialog", { name: "Add section" })).toBeVisible();
  await expect(page.getByRole("dialog").getByLabel("Label")).toHaveValue("");
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /Academic years/ }).click();
  await expect(page.getByRole("heading", { name: "Academic years", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Sections/ }).click();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("academics.png"), fullPage: true });
  await openSection(page, "Attendance", mobile);
  await expect(page.getByText("Attendance loaded.")).toBeAttached();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("attendance.png"), fullPage: true });
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Register history" })).toBeVisible();
  await expect(page.getByText("Loading history...", { exact: true })).not.toBeVisible();
  await expect(page.getByRole("tabpanel").getByRole("alert")).toHaveCount(0);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("attendance-history.png"), fullPage: true });
  await page.getByRole("tab", { name: "Register", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save Draft", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Attendance loaded.")).toBeAttached();
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard\/academics$/);
  await openSection(page, "Account", mobile);
  await expect(page.getByRole("heading", { name: "Your profile" })).toBeVisible();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(errors).toEqual([]);
});

test("teacher attendance creates an owned follow-up with timeline and resolution", async ({
  page,
}, testInfo) => {
  const api = "/api/backend";
  const admin = {
    email: process.env.SCHOOLOS_TEST_EMAIL ?? "admin@schoolos.local",
    password: process.env.SCHOOLOS_TEST_PASSWORD ?? "schoolos-admin-demo",
  };
  const teacher = {
    email: process.env.SCHOOLOS_TEST_TEACHER_EMAIL ?? "teacher@schoolos.local",
    password: process.env.SCHOOLOS_TEST_TEACHER_PASSWORD ?? "schoolos-teacher-demo",
  };
  expect((await page.request.post(`${api}/auth/login`, { data: admin })).ok()).toBe(true);
  const setupResponse = await page.request.get(`${api}/academics/setup`);
  expect(setupResponse.ok()).toBe(true);
  const setup = await setupResponse.json();
  const year = setup.academic_years.find((item: { status: string }) => item.status === "ACTIVE");
  const level = setup.grade_levels.find((item: { status: string }) => item.status === "ACTIVE");
  const policyResponse = await page.request.get(`${api}/actions/policy`);
  expect(policyResponse.ok()).toBe(true);
  const policy = await policyResponse.json();
  test.skip(!policy.enabled, "The school has disabled repeated-absence rules.");
  const teachersResponse = await page.request.get(`${api}/students/users/teachers`);
  expect(teachersResponse.ok()).toBe(true);
  const teacherRecord = (await teachersResponse.json()).find(
    (item: { email: string }) => item.email === teacher.email,
  );
  test.skip(!teacherRecord, "The seeded teacher is not a member of this test school.");
  expect(year).toBeTruthy();
  expect(level).toBeTruthy();
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const number = `ACTION-${suffix}`;
  let sectionId = "";
  let studentId = "";
  let assignmentId = "";
  let actionId = "";
  let guardianLinkId = "";
  try {
    const section = await page.request.post(`${api}/academics/sections`, {
      data: { academic_year_id: year.id, grade_level_id: level.id, label: `Action E2E ${suffix}` },
    });
    expect(section.ok()).toBe(true);
    sectionId = (await section.json()).id;
    const student = await page.request.post(`${api}/students`, {
      data: { student_number: number, given_name: "Follow-up", family_name: "Test" },
    });
    expect(student.ok()).toBe(true);
    studentId = (await student.json()).id;
    const guardian = await page.request.post(`${api}/students/guardians`, {
      data: { display_name: "Synthetic Parent", email: `parent-${suffix}@example.test` },
    });
    expect(guardian.ok()).toBe(true);
    const guardianId = (await guardian.json()).id;
    const linked = await page.request.post(`${api}/students/${studentId}/guardians`, {
      data: {
        guardian_id: guardianId,
        relationship: "Parent",
        portal_access: false,
        can_receive_notifications: true,
        emergency_contact: false,
      },
    });
    expect(linked.ok()).toBe(true);
    guardianLinkId = (await linked.json()).guardian_links.find(
      (item: { guardian_id: string }) => item.guardian_id === guardianId,
    ).id;
    expect(
      (
        await page.request.post(`${api}/students/enrollments`, {
          data: { student_id: studentId, section_id: sectionId, starts_on: year.starts_on },
        })
      ).ok(),
    ).toBe(true);
    const assignment = await page.request.post(`${api}/academics/teacher-assignments`, {
      data: { teacher_user_id: teacherRecord.id, section_id: sectionId },
    });
    expect(assignment.ok()).toBe(true);
    assignmentId = (await assignment.json()).id;
    expect((await page.request.post(`${api}/auth/login`, { data: teacher })).ok()).toBe(true);
    const dates = Array.from({ length: policy.threshold }, (_, index) => {
      const day = new Date(`${year.starts_on}T12:00:00Z`);
      day.setUTCDate(day.getUTCDate() + index);
      return day.toISOString().slice(0, 10);
    });
    for (const day of dates.slice(0, -1)) {
      expect(
        (
          await page.request.post(
            `${api}/attendance/sections/${sectionId}/draft?school_date=${day}`,
            { data: { records: [{ student_id: studentId, mark: "ABSENT" }] } },
          )
        ).ok(),
      ).toBe(true);
      expect(
        (
          await page.request.post(
            `${api}/attendance/sections/${sectionId}/finalize?school_date=${day}`,
          )
        ).ok(),
      ).toBe(true);
    }
    await page.goto("/dashboard/attendance");
    await expect(page.getByText("Attendance loaded.")).toBeAttached();
    const day = dates[dates.length - 1];
    if ((await page.getByLabel("School date").inputValue()) !== day) {
      const loaded = page.waitForResponse((response) =>
        response.url().includes(`/attendance/sections?school_date=${day}`),
      );
      await page.getByLabel("School date").fill(day);
      await loaded;
    }
    await expect(page.getByRole("combobox", { name: "Section", exact: true })).toBeEnabled();
    await page.getByRole("combobox", { name: "Section", exact: true }).selectOption(sectionId);
    await expect(page.getByText("Follow-up Test", { exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Mark", exact: true }).selectOption("ABSENT");
    await page.getByRole("button", { name: "Save Draft", exact: true }).click();
    await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Finalize", exact: true }).click();
    await expect(page.getByText("Attendance finalized.", { exact: true })).toBeVisible();
    const actionsResponse = await page.request.get(`${api}/actions?q=${number}`);
    expect(actionsResponse.ok()).toBe(true);
    const created = (await actionsResponse.json()).items;
    expect(created).toHaveLength(1);
    actionId = created[0].id;
    expect(created[0].assignee_user_id).toBe(teacherRecord.id);
    await openSection(page, "Action Inbox", testInfo.project.name === "mobile");
    await page.getByRole("textbox", { name: "Search follow-ups" }).fill(number);
    await page.getByRole("button", { name: "Search inbox", exact: true }).click();
    const review = page.getByRole("button", { name: "Review follow-up for Follow-up Test" });
    await expect(review).toBeVisible();
    await expect(page.getByRole("button", { name: "Attendance rule", exact: true })).toHaveCount(0);
    await noHorizontalOverflow(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath("action-inbox.png"), fullPage: true });
    await review.click();
    const dialog = page.getByRole("dialog", { name: "Follow-up Test" });
    await expect(dialog.getByText("Repeated unexcused absence", { exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    await expect(dialog.locator(".action-evidence-list > li")).toHaveCount(policy.threshold);
    await expect(dialog.getByRole("combobox", { name: "Owner", exact: true })).toHaveValue(
      teacherRecord.id,
    );
    await page.screenshot({ path: testInfo.outputPath("action-review.png"), fullPage: true });
    await dialog.getByRole("tab", { name: "Timeline", exact: true }).click();
    await expect(dialog.getByText("Attendance follow-up opened", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Staff only", { exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("student-timeline.png"), fullPage: true });
    await dialog.getByRole("tab", { name: "Follow-up", exact: true }).click();
    await dialog.getByRole("combobox", { name: "Status", exact: true }).selectOption("IN_PROGRESS");
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(dialog.locator(".action-review-heading")).toContainText("In progress");
    await dialog.getByRole("tab", { name: "Messages", exact: true }).click();
    await expect(dialog.getByRole("combobox", { name: "Guardian", exact: true })).toContainText(
      "Synthetic Parent",
    );
    await dialog.getByRole("button", { name: "Create draft", exact: true }).click();
    const message = dialog.getByRole("textbox", { name: "Message", exact: true });
    await expect(message).toHaveValue(/Follow-up Test/);
    await expect(dialog.getByText("Revision 1 / Not sent", { exact: true })).toBeVisible();
    await message.fill(`${await message.inputValue()}\n\nPlease contact the school office.`);
    await expect(
      dialog.getByRole("button", { name: "Approve revision 1", exact: true }),
    ).toBeDisabled();
    await dialog.getByRole("tab", { name: "Timeline", exact: true }).click();
    await dialog.getByRole("tab", { name: "Messages", exact: true }).click();
    await expect(message).toHaveValue(/Please contact the school office\./);
    await page.keyboard.press("Escape");
    await expect(
      dialog.getByText("Discard unsaved message changes?", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Keep editing", exact: true }).click();
    await dialog.getByRole("button", { name: "Save revision", exact: true }).click();
    await expect(dialog.getByText("Revision 2 / Not sent", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Approve revision 2", exact: true }).click();
    await expect(dialog.getByText("Approved", { exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("guardian-message.png"), fullPage: true });
    await dialog.getByRole("button", { name: "Revision history", exact: true }).click();
    const history = dialog.getByRole("region", { name: "Message revision history" });
    await expect(history.getByText("Revision 1", { exact: true })).toBeVisible();
    await expect(history.getByText("Revision 2", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
    await review.click();
    await dialog.getByRole("tab", { name: "Messages", exact: true }).click();
    await expect(dialog.getByText("Approved", { exact: true })).toBeVisible();
    await dialog.getByRole("tab", { name: "Follow-up", exact: true }).click();
    await dialog.getByRole("combobox", { name: "Status", exact: true }).selectOption("RESOLVED");
    await expect(dialog.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
    await dialog
      .getByRole("textbox", { name: "Closing reason", exact: true })
      .fill("Synthetic review completed with the guardian.");
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(
      dialog.getByRole("heading", { name: "Closing reason", exact: true }),
    ).toBeVisible();
    await expect(dialog.locator(".action-review-heading")).toContainText("Resolved");
    await dialog.getByRole("tab", { name: "Messages", exact: true }).click();
    await expect(dialog.getByText("Needs review", { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Approve revision 2", exact: true }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
    await page.getByRole("tab", { name: "Closed", exact: true }).click();
    await expect(review).toBeVisible();
    await noHorizontalOverflow(page);
  } finally {
    expect((await page.request.post(`${api}/auth/login`, { data: admin })).ok()).toBe(true);
    if (guardianLinkId)
      expect(
        (
          await page.request.patch(`${api}/students/guardian-links/${guardianLinkId}`, {
            data: { can_receive_notifications: false, portal_access: false },
          })
        ).ok(),
      ).toBe(true);
    if (actionId) {
      const current = await page.request.get(`${api}/actions/${actionId}`);
      if (current.ok()) {
        const item = await current.json();
        if (["OPEN", "IN_PROGRESS"].includes(item.status)) {
          expect(
            (
              await page.request.patch(`${api}/actions/${actionId}`, {
                data: {
                  expected_revision: item.revision,
                  status: "DISMISSED",
                  reason: "Synthetic browser fixture cleanup",
                },
              })
            ).ok(),
          ).toBe(true);
        }
      }
    }
    if (assignmentId)
      expect(
        (
          await page.request.post(`${api}/academics/teacher-assignments/${assignmentId}/deactivate`)
        ).ok(),
      ).toBe(true);
    if (studentId)
      expect((await page.request.post(`${api}/students/${studentId}/deactivate`)).ok()).toBe(true);
    if (sectionId)
      expect(
        (await page.request.post(`${api}/academics/sections/${sectionId}/deactivate`)).ok(),
      ).toBe(true);
  }
});

test("attendance saves, finalizes and retains correction history", async ({ page }, testInfo) => {
  const api = "/api/backend";
  const login = await page.request.post(`${api}/auth/login`, {
    data: {
      email: process.env.SCHOOLOS_TEST_EMAIL ?? "admin@schoolos.local",
      password: process.env.SCHOOLOS_TEST_PASSWORD ?? "schoolos-admin-demo",
    },
  });
  expect(login.ok()).toBe(true);
  const setupResponse = await page.request.get(`${api}/academics/setup`);
  expect(setupResponse.ok()).toBe(true);
  const setup = await setupResponse.json();
  const year = setup.academic_years.find((item: { status: string }) => item.status === "ACTIVE");
  const level = setup.grade_levels.find((item: { status: string }) => item.status === "ACTIVE");
  expect(year).toBeTruthy();
  expect(level).toBeTruthy();
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  let sectionId = "";
  let studentId = "";
  try {
    const sectionResponse = await page.request.post(`${api}/academics/sections`, {
      data: {
        academic_year_id: year.id,
        grade_level_id: level.id,
        label: `Audit E2E ${suffix}`,
      },
    });
    expect(sectionResponse.ok()).toBe(true);
    sectionId = (await sectionResponse.json()).id;
    const studentResponse = await page.request.post(`${api}/students`, {
      data: {
        student_number: `AUDIT-${suffix}`,
        given_name: "Synthetic",
        family_name: "Review",
      },
    });
    expect(studentResponse.ok()).toBe(true);
    studentId = (await studentResponse.json()).id;
    const enrollment = await page.request.post(`${api}/students/enrollments`, {
      data: {
        student_id: studentId,
        section_id: sectionId,
        starts_on: year.starts_on,
      },
    });
    expect(enrollment.ok()).toBe(true);
    await page.goto("/dashboard/attendance");
    await expect(page.getByText("Attendance loaded.")).toBeAttached();
    if ((await page.getByLabel("School date").inputValue()) !== year.starts_on) {
      const loaded = page.waitForResponse((response) =>
        response.url().includes(`/attendance/sections?school_date=${year.starts_on}`),
      );
      await page.getByLabel("School date").fill(year.starts_on);
      await loaded;
    }
    await expect(page.getByRole("combobox", { name: "Section", exact: true })).toBeEnabled();
    await page.getByRole("combobox", { name: "Section", exact: true }).selectOption(sectionId);
    await expect(page.getByText("Synthetic Review", { exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Mark", exact: true }).selectOption("ABSENT");
    await page.getByLabel("Note", { exact: true }).fill("Private synthetic note");
    await page.getByRole("button", { name: "Save Draft", exact: true }).click();
    await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Finalize", exact: true }).click();
    await expect(page.getByText("Attendance finalized.", { exact: true })).toBeVisible();
    await expect(page.locator(".attendance-section-list button.active")).toContainText("FINAL");
    await expect(page.locator(".attendance-section-list button.active")).toContainText("1/1");
    await expect(page.getByRole("button", { name: "Correct", exact: true })).toBeDisabled();
    await page.getByRole("combobox", { name: "Mark", exact: true }).selectOption("EXCUSED");
    const reason = "Guardian confirmed the synthetic appointment. ".repeat(6).trim();
    await page.getByLabel("Reason", { exact: true }).fill(reason);
    await page.getByRole("button", { name: "Correct", exact: true }).click();
    await expect(page.getByText("Correction saved.", { exact: true })).toBeVisible();
    const duplicate = await page.request.post(
      `${api}/attendance/sections/${sectionId}/finalize?school_date=${year.starts_on}`,
    );
    expect(duplicate.ok()).toBe(true);
    await page.getByRole("tab", { name: "History", exact: true }).click();
    await expect(page.getByText("Attendance corrected", { exact: true })).toBeVisible();
    await expect(page.getByText("Register finalized", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("tabpanel").getByText("Draft saved", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Synthetic Review: absent to excused", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(reason, { exact: true })).toBeVisible();
    await expect(page.locator(".attendance-history-list > li")).toHaveCount(3);
    await expect(page.getByText("Private synthetic note", { exact: true })).not.toBeVisible();
    await noHorizontalOverflow(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath("attendance-correction-history.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText("Attendance corrected", { exact: true })).toBeVisible();
    await expect(page.locator(".attendance-history-list > li")).toHaveCount(3);
  } finally {
    if (studentId) {
      expect((await page.request.post(`${api}/students/${studentId}/deactivate`)).ok()).toBe(true);
    }
    if (sectionId) {
      expect(
        (await page.request.post(`${api}/academics/sections/${sectionId}/deactivate`)).ok(),
      ).toBe(true);
    }
  }
});
