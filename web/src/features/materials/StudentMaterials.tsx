import { useQuery } from "@tanstack/react-query";
import { usePageTitle } from "../../app/pages";
import { Card, EmptyState, ErrorBanner, Loading, PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";

/** /student/materials: training links of the categories of the student's exams (docs/FIXES_PLAN.md fix 2). */
export function StudentMaterials() {
  usePageTitle("Materials");
  const sections = useQuery({ queryKey: qk.studentMaterials, queryFn: api.student.materials });

  return (
    <>
      <PageHeader title="Materials" description="Study material for the topics of your exams." />
      {sections.isPending ? (
        <Loading />
      ) : sections.error ? (
        <ErrorBanner error={sections.error} onRetry={() => void sections.refetch()} />
      ) : sections.data.length === 0 ? (
        <EmptyState title="No materials yet">When your instructors share material, it appears here.</EmptyState>
      ) : (
        <div className="space-y-6">
          {sections.data.map((s) => (
            <Card key={s.category.id} title={s.category.name}>
              {s.materials.length > 0 && <Links label={`Materials of ${s.category.name}`} links={s.materials} />}
              {s.exams.map((e) => (
                <div key={e.id} className="mt-4">
                  <h3 className="mb-2 text-sm font-semibold text-slate-700">For {e.title}</h3>
                  <Links label={`Materials of ${e.title}`} links={e.materials} />
                </div>
              ))}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function Links({ label, links }: { label: string; links: { title: string; url: string }[] }) {
  return (
    <ul aria-label={label} className="space-y-1">
      {links.map((m) => (
        <li key={m.url + m.title}>
          <a
            href={m.url}
            target="_blank"
            rel="noreferrer noopener"
            className="font-semibold text-brand-700 hover:underline"
          >
            {m.title}
          </a>
        </li>
      ))}
    </ul>
  );
}
