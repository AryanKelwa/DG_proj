import { getAllProducts } from "@/modules/catalog/catalog-store";
import { VariableDataUploader } from "@/modules/variable-data/components/variable-data-uploader";

export const metadata = {
  title: "Bulk Names & Numbers · W2P Print House",
  description: "Print a personalised race bib, number board or badge for every name and number in your spreadsheet.",
};

export const revalidate = 60;

export default async function VariableDataPage() {
  const products = (await getAllProducts())
    .filter((p) => p.has_variable_data)
    .map((p) => ({ slug: p.slug, name: p.name }));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
      <div className="space-y-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-500/10 text-brand-600 text-xs font-medium">
          Personalised printing
        </span>
        <h1 className="text-3xl sm:text-4xl font-extrabold font-heading tracking-tight">Bulk Names &amp; Numbers</h1>
        <p className="text-muted-foreground max-w-2xl">
          Check your list here, then design one layout. We print a separate piece for every name and number on it.
        </p>
      </div>

      <VariableDataUploader products={products} />
    </div>
  );
}
