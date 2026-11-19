import React from "react";
import { notFound } from "next/navigation";
import { DesignerPageView } from "@/modules/designer/components/designer-page-view";
import { getDraft, createDraft } from "@/modules/drafts/draft-store";
import { getProductBySlug } from "@/modules/catalog/catalog-store";

// Always rendered per request: every visit works on its own draft.
export const dynamic = "force-dynamic";

export default async function DesignerPage({
  params,
  searchParams,
}: {
  params: Promise<{ productSlug: string }>;
  searchParams: Promise<{ draft?: string; w?: string; h?: string; mat?: string; qty?: string }>;
}) {
  const { productSlug } = await params;
  const sParams = await searchParams;

  const product = await getProductBySlug(productSlug);
  if (!product || !product.is_active) {
    notFound();
  }

  // Task 2: Retrieve persisted draft or instantiate sensible default
  let draft = sParams.draft ? await getDraft(sParams.draft) : null;

  if (!draft) {
    const width = Number(sParams.w) || product.default_width_mm;
    const height = Number(sParams.h) || product.default_height_mm;
    const material = sParams.mat || product.allowed_materials[0]?.id || "default";
    const qty = Number(sParams.qty) || 100;

    draft = await createDraft({
      productId: product.id,
      widthMm: width,
      heightMm: height,
      materialId: material,
      quantity: qty,
    });
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <DesignerPageView
        product={product}
        draftId={draft.id}
        initialWidthMm={draft.options.widthMm}
        initialHeightMm={draft.options.heightMm}
        selectedMaterialId={draft.options.materialId}
        quantity={draft.quantity}
      />
    </div>
  );
}
