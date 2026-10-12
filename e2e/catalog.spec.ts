import { asUser, authFile, confirmDialog, examId, expect, freshStaff, test, uid, WORLD } from "./fixtures";

test.describe("categories and tags (super admin)", () => {
  test.use({ storageState: authFile("admin") });

  test("add, rename, archive, restore and delete a category", async ({ page }) => {
    const name = `E2E Cat ${uid("c")}`;
    await page.goto("/admin/catalog");
    const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Categories" }) });
    await card.getByRole("textbox", { name: "New category" }).fill(name);
    await card.getByRole("button", { name: "Add" }).click();
    const table = page.getByRole("table", { name: "Categories" });
    await expect(table.getByRole("row", { name: new RegExp(name) })).toBeVisible();
    const slug =
      (await table
        .getByRole("row", { name: new RegExp(name) })
        .locator(".font-mono")
        .textContent()) ?? "";

    await expect(card.getByRole("textbox", { name: "New category" })).toHaveValue(""); // saved

    // Duplicate names are refused, whatever the case.
    await card.getByRole("textbox", { name: "New category" }).fill(name.toUpperCase());
    await card.getByRole("button", { name: "Add" }).click();
    await expect(card.getByRole("alert")).toContainText("already exists");

    // Renaming keeps the slug.
    await table.getByRole("button", { name: `Rename ${name}` }).click();
    await page
      .getByRole("dialog", { name: "Rename category" })
      .getByRole("textbox", { name: "New name" })
      .fill(`${name} Renamed`);
    await page.getByRole("dialog").getByRole("button", { name: "Rename" }).click();
    const renamed = table.getByRole("row", { name: new RegExp(`${name} Renamed`) });
    await expect(renamed).toContainText(slug);

    // Archived categories are hidden unless asked for.
    await renamed.getByRole("button", { name: /^Archive / }).click();
    await expect(table.getByRole("row", { name: new RegExp(name) })).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Show archived" }).check();
    await expect(table.getByRole("row", { name: new RegExp(name) })).toContainText("Archived");
    await table.getByRole("button", { name: `Restore ${name} Renamed` }).click();
    await expect(table.getByRole("row", { name: new RegExp(name) })).not.toContainText("Archived");

    // An unused category can be deleted.
    await table.getByRole("button", { name: `Delete ${name} Renamed` }).click();
    await confirmDialog(page, /^Delete /, "Delete");
    await expect(table.getByRole("row", { name: new RegExp(name) })).toHaveCount(0);
  });

  test("a category in use can't be deleted: the page explains and offers archiving", async ({ page }) => {
    await page.goto("/admin/catalog");
    await page.getByRole("button", { name: `Delete ${WORLD.categories.networking.name}`, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("can't be deleted. Archive it instead");
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  test("add, rename and delete a tag", async ({ page }) => {
    const name = `e2e-tag-${uid("t")}`;
    await page.goto("/admin/catalog");
    await page.getByRole("textbox", { name: "New tag" }).fill(name);
    await page
      .locator("form")
      .filter({ has: page.getByRole("textbox", { name: "New tag" }) })
      .getByRole("button", { name: "Add" })
      .click();
    const tags = page.getByRole("table", { name: "Tags" });
    await expect(tags).toContainText(name);
    await tags.getByRole("button", { name: `Rename ${name}` }).click();
    await page.getByRole("dialog").getByRole("textbox", { name: "New name" }).fill(`${name}-x`);
    await page.getByRole("dialog").getByRole("button", { name: "Rename" }).click();
    await expect(tags).toContainText(`${name}-x`);
    await tags.getByRole("button", { name: `Delete ${name}-x` }).click();
    await confirmDialog(page, /^Delete the tag/, "Delete tag");
    // With no tags left the table gives way to the empty state, so look for the name anywhere.
    await expect(page.getByText(`${name}-x`)).toHaveCount(0);
  });
});

test.describe("exams (super admin)", () => {
  test.use({ storageState: authFile("admin") });

  test("create a draft exam, edit it, publish it, move it, and find it with the filters", async ({ page }) => {
    const code = `E2E-${uid("x").toUpperCase().slice(-10)}`;
    const title = `E2E Exam ${code}`;
    await page.goto("/exams");
    await page.getByRole("link", { name: "New exam" }).click();
    await page.getByRole("textbox", { name: "Title" }).fill(title);
    await page.getByRole("textbox", { name: "Code" }).fill(code.toLowerCase());
    await page.getByRole("combobox", { name: "Category" }).selectOption({ label: WORLD.categories.networking.name });
    await page.getByRole("spinbutton", { name: "Duration (minutes)" }).fill("0");
    await page.getByRole("button", { name: "Create exam" }).click();
    await expect(page.getByText("At least 1")).toBeVisible();
    await page.getByRole("spinbutton", { name: "Duration (minutes)" }).fill("60");
    await page.getByRole("button", { name: "Create exam" }).click();

    // Lands on the new exam: a draft, code uppercased.
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByRole("main")).toContainText(code);
    await expect(page.getByRole("main").getByText("Draft").first()).toBeVisible();

    // Edit a setting.
    await page.getByRole("spinbutton", { name: "Attempts allowed" }).fill("2");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Exam saved" })).toBeVisible();

    // Publishing needs a valid question (questions.spec covers the editor): blocked first, then allowed.
    await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();
    const examIdFromUrl = new URL(page.url()).pathname.split("/")[2] ?? "";
    await page.request.post(`/api/catalog/exams/${examIdFromUrl}/questions`, {
      data: {
        type: "TRUE_FALSE",
        text: "Ready?",
        options: [
          { text: "True", isCorrect: true },
          { text: "False", isCorrect: false },
        ],
      },
    });
    await page.reload();
    await page.getByRole("button", { name: "Publish" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Exam is now published" })).toBeVisible();

    // Move to another category: asks first.
    await page.getByRole("combobox", { name: "Category" }).selectOption({ label: WORLD.categories.cloud.name });
    await page.getByRole("button", { name: "Save changes" }).click();
    await page
      .getByRole("dialog", { name: "Move to another category?" })
      .getByRole("button", { name: "Move and save" })
      .click();
    await expect(page.getByRole("main")).toContainText(`· ${WORLD.categories.cloud.name}`);

    // Filters on the list.
    await page.goto("/exams");
    await page.getByRole("searchbox", { name: "Search" }).fill(code);
    const table = page.getByRole("table", { name: "Exams" });
    await expect(table.getByRole("row")).toHaveCount(2);
    await page.getByRole("combobox", { name: "Status" }).selectOption("DRAFT");
    await expect(page.getByText("No exams match")).toBeVisible();
    await page.getByRole("combobox", { name: "Status" }).selectOption("PUBLISHED");
    await expect(table).toContainText(title);
  });

  test("a duplicate code is refused", async ({ page }) => {
    await page.goto("/exams/new");
    await page.getByRole("textbox", { name: "Title" }).fill("Duplicate");
    await page.getByRole("textbox", { name: "Code" }).fill(WORLD.exams.cloudGates.code);
    await page.getByRole("combobox", { name: "Category" }).selectOption({ label: WORLD.categories.cloud.name });
    await page.getByRole("button", { name: "Create exam" }).click();
    await expect(page.getByRole("alert")).toHaveText("That code is already used by another exam.");
  });

  test("the dashboard's exam numbers open the list pre-filtered", async ({ page }) => {
    await page.goto("/admin");
    await page.getByRole("link", { name: /^Published exams: / }).click();
    await expect(page).toHaveURL(/\/exams\?status=PUBLISHED$/);
    await expect(page.getByRole("combobox", { name: "Status" })).toHaveValue("PUBLISHED");
  });
});

test.describe("exams (instructors)", () => {
  test.use({ storageState: authFile("instCloud") });

  test("see and edit only exams in their category; create only there", async ({ page, apiAs }) => {
    await page.goto("/exams");
    const table = page.getByRole("table", { name: "Exams" });
    await expect(table).toContainText(WORLD.exams.cloudGates.title);
    await expect(table).not.toContainText(WORLD.exams.netBasics.title);

    await table.getByRole("link", { name: new RegExp(WORLD.exams.cloudGates.title) }).click();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();

    await page.goto("/exams/new");
    await expect(page.getByRole("combobox", { name: "Category" }).locator("option")).toHaveText([
      "Choose…",
      WORLD.categories.cloud.name,
    ]);

    // Outside the grant: the same answer as a missing exam.
    await page.goto(`/exams/${await examId(await apiAs("admin"), "netBasics")}`);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });
});

test("an instructor without EXAM_EDIT sees the settings read-only", async ({ browser, apiAs, playwright, baseURL }) => {
  const admin = await apiAs("admin");
  const inst = await freshStaff(admin, playwright, baseURL ?? "", "Rita Readonly", {
    permissions: ["RESULTS_VIEW"],
    allExams: true,
    allGroups: true,
  });
  const { context, page } = await asUser(
    browser,
    `/exams/${await examId(admin, "cloudGates")}`,
    inst.username,
    inst.password,
  );
  await expect(page.getByText("Read only: editing this exam needs")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Title" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
  await page.goto("/exams");
  await expect(page.getByRole("link", { name: "New exam" })).toHaveCount(0);
  await context.close();
});
