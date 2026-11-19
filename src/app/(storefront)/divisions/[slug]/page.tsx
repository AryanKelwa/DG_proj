import React from "react";
import { notFound } from "next/navigation";
import { DIVISIONS, PRODUCTS } from "@/lib/data/mock-data";
import { DivisionView } from "@/modules/catalog/components/division-view";

export async function generateStaticParams() {
  return DIVISIONS.map((d) => ({ slug: d.slug }));
}

export default async function DivisionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const division = DIVISIONS.find((d) => d.slug === slug);

  if (!division) {
    notFound();
  }

  const products = PRODUCTS.filter((p) => p.division_slug === slug);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <DivisionView division={division} products={products} />
    </div>
  );
}
