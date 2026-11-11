import { useEffect } from "react";
import { useLocation } from "react-router";
import { useExam } from "../exams/ExamLayout";
import { ExamAssignments } from "./ExamAssignments";
import { ExamAvailability } from "./ExamAvailability";
import { ExamOverrides } from "./ExamOverrides";

/**
 * /exams/:id/access, "Who and when": one place for the question staff actually ask, who can take
 * this exam and when. Each student's status and why first (with actions on the row), then who it is
 * assigned to and on what schedule, then the open/close overrides on top of the schedule.
 */
export function WhoAndWhen() {
  const { allowed } = useExam();
  const manage = allowed("EXAM_ASSIGN") || allowed("EXAM_SCHEDULE");
  const { hash } = useLocation();

  // The old tab addresses land here with #assignments or #overrides: show that section.
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash]);

  return (
    <div className="space-y-6">
      <section id="availability" className="scroll-mt-4">
        <ExamAvailability />
      </section>
      {manage && (
        <>
          <section id="assignments" className="scroll-mt-4">
            <ExamAssignments />
          </section>
          <section id="overrides" className="scroll-mt-4">
            <ExamOverrides />
          </section>
        </>
      )}
    </div>
  );
}
