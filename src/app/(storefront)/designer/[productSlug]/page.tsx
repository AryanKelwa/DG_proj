import React from "react";
import { notFound } from "next/navigation";
import { PRODUCTS } from "@/lib/data/mock-data";
import { DesignerPageView } from "@/modules/designer/components/designer-page-view";
import { getDraft, createDraft } from "@/modules/drafts/draft-store";

export async function generateStaticParams() {
  return PRODUCTS.map((p) => ({ productSlug: p.slug }));
}

export default async function DesignerPage({
  params,
  searchParams,
}: {
  params: Promise<{ productSlug: string }>;
  searchParams: Promise<{ draft?: string; w?: string; h?: string; mat?: string; qty?: string }>;
}) {
  const { productSlug } = await params;
  const sParams = await searchParams;

  const product = PRODUCTS.find((p) => p.slug === productSlug);
  if (!product) {
    notFound();
  }

  // Task 2: Retrieve persisted draft or instantiate sensible default
  let draft = sParams.draft ? getDraft(sParams.draft) : null;

  if (!draft) {
    const width = Number(sParams.w) || product.default_width_mm;
    const height = Number(sParams.h) || product.default_height_mm;
    const material = sParams.mat || product.allowed_materials[0]?.id || "default";
    const qty = Number(sParams.qty) || 100;

    draft = createDraft({
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
