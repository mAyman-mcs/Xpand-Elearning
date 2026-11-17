-- docs/FIXES_PLAN.md fix 1: a picture's description (alt text) is optional. A picture without one
-- is shown as decorative (alt="").
ALTER TABLE "Option" DROP CONSTRAINT "Option_image_alt";
ALTER TABLE "Question" DROP CONSTRAINT "Question_image_alt";
ALTER TABLE "QuestionCase" DROP CONSTRAINT "QuestionCase_image_alt";
