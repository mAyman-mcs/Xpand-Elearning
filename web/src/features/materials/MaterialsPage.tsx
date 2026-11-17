import type { CategoryMaterials } from "@contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLocation } from "react-router";
import { usePageTitle } from "../../app/pages";
import { Card, EmptyState, ErrorBanner, Loading, PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { LinkEditor } from "../content/LinkEditor";

/**
 * /materials (staff): training links per category (docs/FIXES_PLAN.md fix 2). Students see a
 * category's links when they have a published exam in it. Editing needs EXAM_EDIT on the category.
 */
export function MaterialsPage() {
  usePageTitle("Materials");
  const sections = useQuery({ queryKey: qk.categoryMaterials, queryFn: api.materials.byCategory });
  const { hash } = useLocation();

  // "Materials" links on the Categories page land on #category-<id>.
  useEffect(() => {
    if (hash && sections.data) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash, sections.data]);

  return (
    <>
      <PageHeader
        title="Materials"
        description="Links for every exam of a category: students see them once they have a published exam in it."
      />
      {sections.isPending ? (
        <Loading />
      ) : sections.error ? (
        <ErrorBanner error={sections.error} onRetry={() => void sections.refetch()} />
      ) : sections.data.length === 0 ? (
        <EmptyState title="No categories yet">Categories your access covers appear here.</EmptyState>
      ) : (
        <div className="space-y-6">
          {sections.data.map((s) => (
            <CategorySection key={s.category.id} section={s} />
          ))}
        </div>
      )}
    </>
  );
}

function CategorySection({ section: s }: { section: CategoryMaterials }) {
  const queryClient = useQueryClient();
  return (
    <section id={`category-${s.category.id}`} className="scroll-mt-4">
      <Card title={s.category.name}>
        <LinkEditor
          caption={`Materials of ${s.category.name}`}
          rows={s.materials}
          loading={false}
          error={null}
          canEdit={s.canEdit}
          onAdd={(input) => api.materials.createForCategory(s.category.id, input)}
          onChanged={() => queryClient.invalidateQueries({ queryKey: qk.categoryMaterials })}
        />
      </Card>
    </section>
  );
}
