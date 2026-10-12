import { readFile } from "node:fs/promises";
import { authFile, expect, test, uid, WORLD } from "./fixtures";

test.use({ storageState: authFile("admin") });

const csv = (lines: string[]) => ({
  name: "students.csv",
  mimeType: "text/csv",
  buffer: Buffer.from(lines.join("\r\n")),
});

test("a file with problems lists them by line and creates nothing", async ({ page }) => {
  await page.goto("/admin/users/import");
  const id = uid("bad").toLowerCase();
  await page
    .getByLabel("CSV file")
    .setInputFiles(
      csv([
        "username,fullName,group,groupIntakeDate",
        `${id}.ok,Okay Person,,`,
        "x,,,",
        `${WORLD.users.studentA1.username},Taken,,`,
      ]),
    );
  const problems = page.getByRole("table", { name: "Problems" });
  await expect(page.getByRole("alert")).toContainText("problems found");
  // Per-row problems first (the database checks run once the rows themselves are valid).
  await expect(problems.getByRole("row").nth(1)).toContainText("3"); // CSV line 3
  await expect(problems).toContainText("Required");
  await expect(page.getByRole("button", { name: /^Import / })).toHaveCount(0);

  await page
    .getByLabel("CSV file")
    .setInputFiles(csv(["username,fullName", `${id}.ok,Okay Person`, `${WORLD.users.studentA1.username},Taken`]));
  await expect(problems).toContainText("This username already exists");
});

test("a file without the required columns is refused before checking", async ({ page }) => {
  await page.goto("/admin/users/import");
  await page.getByLabel("CSV file").setInputFiles(csv(["name,email", "Someone,someone@example.com"]));
  await expect(page.getByRole("alert")).toContainText('"username" and "fullName" are required');
});

test("a valid file creates the students and a new group; credentials are shown once and downloadable", async ({
  page,
}) => {
  const id = uid("imp").toLowerCase();
  const group = `E2E Imported ${id}`;
  await page.goto("/admin/users/import");
  await page
    .getByLabel("CSV file")
    .setInputFiles(
      csv([
        "username,fullName,email,mobile,group,groupIntakeDate,joinDate",
        `${id}.one,Imported One,one@example.com,,${group},2026-11-01,`,
        `${id}.two,"Imported Two, Jr.",,,${group},2026-11-01,2026-11-15`,
      ]),
    );
  await expect(page.getByText("2 students will be created.")).toBeVisible();
  await expect(page.getByText(`New groups: ${group}.`)).toBeVisible();
  await page.getByRole("button", { name: "Import 2 students" }).click();

  const dialog = page.getByRole("dialog", { name: "2 students imported" });
  await expect(dialog.getByTestId("secret-value")).toHaveCount(2);
  const password = (await dialog.getByTestId("secret-value").first().textContent()) ?? "";

  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download credentials (CSV)" }).click();
  const file = await readFile((await (await download).path()) ?? "", "utf8");
  expect(file).toContain(`${id}.one`);
  expect(file).toContain('"Imported Two, Jr."');
  expect(file).toContain(password);

  await dialog.getByRole("button", { name: "I have saved them" }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);

  // The new group exists with both students, and the password works.
  await page.goto("/admin/groups");
  await page.getByRole("link", { name: group }).click();
  await expect(page.getByRole("table", { name: "Members" }).getByRole("row")).toHaveCount(3);
  const res = await page.request.post("/api/auth/login", { data: { username: `${id}.one`, password } });
  expect(res.status()).toBe(200);
});
