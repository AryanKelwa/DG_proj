import { Suspense } from "react";
import { PricingCalculator } from "@/modules/pricing/components/pricing-calculator";

export const metadata = {
  title: "Instant Price Calculator · W2P Print House",
  description: "Live instant pricing by dimensions, material multiplier, and automated volume discount floors. Fully transparent with VAT breakdown.",
};

export default function CalculatorPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="mb-8 space-y-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-500/10 text-brand-600 dark:text-brand-400 text-xs font-medium">
          Live Pricing Calculator
        </span>
        <h1 className="text-3xl sm:text-4xl font-extrabold font-heading tracking-tight">
          Instant Pricing Engine
        </h1>
        <p className="text-muted-foreground text-sm max-w-2xl">
          Real-time per-unit pricing powered by parametric formulas. Adjust width and height down to the exact millimeter, select your substrate material, and watch volume discounts apply automatically.
        </p>
      </div>

      <Suspense fallback={<div className="p-8 text-center text-xs font-mono">Loading pricing matrix...</div>}>
        <PricingCalculator />
      </Suspense>
    </div>
  );
}
