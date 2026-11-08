import { png } from "../../test/images.js";
import { statuses, type MatrixRow } from "../../test/matrix.js";

// Uploading needs EXAM_EDIT on the exam: E3 (Cloud) is edited by the super admin and instCategory.
// Reading is per picture: staff who can see E3 (the same two), and students only during an attempt
// of an exam using the picture (student B has none: 404). Details in uploads.int.test.ts.

export const uploadsRows: MatrixRow[] = [
  {
    route: "POST /api/uploads",
    request: (w) => ({ path: `/api/uploads?examId=${w.e3.id}`, raw: { type: "image/png", data: png() } }),
    expect: statuses(404, { superAdmin: 201, student: 403, instCategory: 201 }),
  },
  {
    route: "GET /api/uploads/:id",
    request: (w) => ({ path: `/api/uploads/${w.pictureE3.id}` }),
    expect: statuses(404, { superAdmin: 200, instCategory: 200 }),
  },
];
