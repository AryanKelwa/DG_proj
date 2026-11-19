"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { JobDraft } from "@/types/draft";
import { PricingBreakdown } from "@/modules/pricing/pricing-engine";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CreditCard,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Lock,
  Truck,
  Sparkles,
  Layers,
  ArrowLeft,
  Loader2,
  AlertTriangle,
} from "lucide-react";

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const draftId = searchParams.get("draft");
  const [draft, setDraft] = useState<JobDraft | null>(null);
  const [pricing, setPricing] = useState<PricingBreakdown | null>(null);
  const [product, setProduct] = useState<{ name: string; default_bleed_mm: number } | null>(null);
  const [divisionName, setDivisionName] = useState<string>("");
  const [isLoadingDraft, setIsLoadingDraft] = useState<boolean>(true);
  const [gateError, setGateError] = useState<string | null>(null);

  // Shipping & Contact State - Issue 1: Bound to real state without hardcoded dummy defaults
  const [customerName, setCustomerName] = useState(user?.full_name || "");
  const [customerEmail, setCustomerEmail] = useState(user?.email || "");
  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("United Kingdom");

  // Keep state updated when auth user becomes available
  useEffect(() => {
    if (user) {
      setCustomerName((prev) => prev || user.full_name || "");
      setCustomerEmail((prev) => prev || user.email || "");
    }
  }, [user]);

  // Payment State
  const [paymentMethod, setPaymentMethod] = useState<"card" | "stripe_hosted">("card");
  const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
  const [cardExpiry, setCardExpiry] = useState("12/28");
  const [cardCvc, setCardCvc] = useState("123");
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Task 2, Task 3 & Task 5: Load draft authoritatively from server and enforce proof approval gate
  useEffect(() => {
    if (!draftId) {
      setGateError("No draft specified. You must configure a product and approve a proof before payment (§ 01, § 05, § 08).");
      setIsLoadingDraft(false);
      return;
    }

    fetch(`/api/drafts/${draftId}`)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Job draft record not found");
        }
        return res.json();
      })
      .then((data) => {
        const d: JobDraft = data.draft;
        setDraft(d);
        setPricing(data.pricing);
        setProduct(data.product);
        setDivisionName(data.division?.name ?? "");

        // Enforce Workflow Order (§ 01, § 03, § 05, § 08)
        if (d.status !== "proof_approved" && d.status !== "payment_pending") {
          setGateError(
            `Approval Gate Violation: Draft is in "${d.status}" status. Customer proof must be inspected and approved before payment (§ 08 & § 05).`
          );
        }
      })
      .catch((err) => {
        setGateError(err.message || "Failed to load job draft");
      })
      .finally(() => {
        setIsLoadingDraft(false);
      });
  }, [draftId]);

  const handleTestCardFill = (number: string) => {
    setCardNumber(number);
    setErrorMessage(null);
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;

    // Issue 1: Client-side validation for address and contact details
    if (
      !customerName.trim() ||
      !customerEmail.trim() ||
      !addressLine.trim() ||
      !city.trim() ||
      !postalCode.trim() ||
      !country.trim()
    ) {
      setErrorMessage("Please complete all required contact and shipping address fields.");
      return;
    }

    const ukPostcodeRegex = /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i;
    const isUK =
      country.toLowerCase().includes("united kingdom") ||
      country.toLowerCase() === "gb" ||
      country.toLowerCase() === "uk";

    if (isUK && !ukPostcodeRegex.test(postalCode.trim())) {
      setErrorMessage("Please enter a valid UK postcode (e.g. SW1A 2AA, M1 1AA, LA22 0QJ).");
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    setStatusNotice(null);

    try {
      const res = await fetch("/api/checkout/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: draft.id,
          customerName,
          customerEmail,
          paymentMethod,
          cardNumber,
          shippingAddress: {
            line1: addressLine,
            city,
            postal_code: postalCode,
            country,
          },
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || "Payment transaction could not be completed.");
        setIsProcessing(false);
        return;
      }

      if (data.requiresAction) {
        setStatusNotice(data.message || "3D Secure authentication successful!");
      }

      // If hosted Stripe checkout URL returned
      if (data.checkoutUrl) {
        if (data.checkoutUrl.startsWith("http")) {
          window.location.href = data.checkoutUrl;
        } else {
          router.push(data.checkoutUrl);
        }
      } else {
        router.push(`/dashboard?checkout_success=true&order_number=${data.orderNumber}`);
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Network error during checkout.");
      setIsProcessing(false);
    }
  };

  // 1. Loading State
  if (isLoadingDraft) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center space-y-4">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-brand-500" />
        <h2 className="text-xl font-bold font-heading">Loading Verified Job Draft...</h2>
        <p className="text-xs font-mono text-muted-foreground">
          Recalculating server-side pricing and verifying cryptographic proof gate.
        </p>
      </div>
    );
  }

  // 2. Workflow Gate Rejection View (Task 3: Rejection on direct access without approved proof)
  if (gateError || !draft || !pricing || !product) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16">
        <Card className="border-destructive/40 shadow-elevation">
          <CardHeader className="text-center space-y-2">
            <div className="w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <CardTitle className="text-xl font-bold font-heading">
              Workflow Order Violation
            </CardTitle>
            <CardDescription className="text-xs font-mono">
              PRD § 01, § 05 & § 08: Mandatory Customer Proof Gate
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              {gateError || "Checkout is strictly guarded. You cannot pay for an order without an approved proof."}
            </p>
            <div className="p-3 rounded-lg bg-secondary/50 border text-xs font-mono text-left space-y-1">
              <div>• PRD Step 1: Browse Divisions</div>
              <div>• PRD Step 2: Configure & Price</div>
              <div>• PRD Step 3: Sign In</div>
              <div>• PRD Step 4: Design / Upload</div>
              <div>• PRD Step 5-6: Preview Proof & Approve (Required before checkout)</div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-center gap-3">
            <Button
              variant="default"
              onClick={() => {
                if (draft) {
                  router.push(`/designer/${draft.productSlug}?draft=${draft.id}`);
                } else {
                  router.push("/calculator");
                }
              }}
              className="font-semibold text-xs"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
              Return to Designer & Inspect Proof
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const approvedProof = draft.proofs.find((p) => p.version === draft.proofVersion);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-14 space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <Link
            href={`/designer/${draft.productSlug}?draft=${draft.id}`}
            className="text-xs font-mono text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Designer & Proof
          </Link>
          <h1 className="text-3xl font-extrabold font-heading tracking-tight text-foreground">
            Order Checkout & Payment
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Single-transaction per-order checkout for approved job #{draft.id}. Fully GST-compliant with instant order confirmation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs font-mono py-1 px-3 border-emerald-500/30 text-emerald-600 bg-emerald-500/10">
            <Lock className="w-3 h-3 mr-1" />
            256-Bit SSL Encrypted
          </Badge>
          <Badge variant="industrial" className="text-xs font-mono py-1 px-3">
            {divisionName}
          </Badge>
        </div>
      </div>

      {errorMessage && (
        <div className="p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Transaction Unsuccessful</div>
            <p className="text-xs mt-0.5">{errorMessage}</p>
          </div>
        </div>
      )}

      {statusNotice && (
        <div className="p-4 rounded-xl border border-blue-500/50 bg-blue-500/10 text-blue-600 dark:text-blue-400 text-sm flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
          <p className="text-xs">{statusNotice}</p>
        </div>
      )}

      <form onSubmit={handleSubmitPayment} className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Delivery & Payment Details */}
        <div className="lg:col-span-7 space-y-6">
          {/* Customer & Shipping Details */}
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2 text-brand-600 dark:text-brand-400 text-xs font-mono font-semibold uppercase">
                <Truck className="w-4 h-4" />
                <span>1. Shipping & Customer Contact</span>
              </div>
              <CardTitle className="text-lg">Delivery Information</CardTitle>
              <CardDescription className="text-xs">
                Where should we ship your finished print order?
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Full Name / Organisation</label>
                  <input
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Email Address (for invoices & tracking)</label>
                  <input
                    type="email"
                    required
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Delivery Street Address</label>
                <input
                  type="text"
                  required
                  value={addressLine}
                  onChange={(e) => setAddressLine(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">City</label>
                  <input
                    type="text"
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Postal Code</label>
                  <input
                    type="text"
                    required
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Country</label>
                  <input
                    type="text"
                    required
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Payment Gateway Card */}
          <Card className="border-brand-500/40 shadow-elevation">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-brand-600 dark:text-brand-400 text-xs font-mono font-semibold uppercase">
                  <CreditCard className="w-4 h-4" />
                  <span>2. Payment Gateway (Stripe Integrated)</span>
                </div>
                <Badge variant="outline" className="text-[10px] font-mono border-brand-500/40 text-brand-600 bg-brand-50 dark:bg-brand-950/40">
                  PCI-DSS Level 1 Compliant
                </Badge>
              </div>
              <CardTitle className="text-lg">Select Payment Method</CardTitle>
              <CardDescription className="text-xs">
                Per-order billing only. We never charge recurring fees or subscriptions.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5">
              {/* Payment Method Selector */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPaymentMethod("card")}
                  className={`p-3 rounded-lg border text-left flex flex-col justify-between transition-all ${
                    paymentMethod === "card"
                      ? "border-brand-500 bg-brand-50/50 dark:bg-brand-950/30 ring-1 ring-brand-500"
                      : "border-border hover:border-muted-foreground/40 bg-card"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-bold font-heading">Direct Card Payment</span>
                    <CreditCard className="w-4 h-4 text-brand-500" />
                  </div>
                  <span className="text-[11px] text-muted-foreground mt-2">
                    Card, Apple Pay, Google Pay
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod("stripe_hosted")}
                  className={`p-3 rounded-lg border text-left flex flex-col justify-between transition-all ${
                    paymentMethod === "stripe_hosted"
                      ? "border-brand-500 bg-brand-50/50 dark:bg-brand-950/30 ring-1 ring-brand-500"
                      : "border-border hover:border-muted-foreground/40 bg-card"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-bold font-heading">Stripe Hosted Checkout</span>
                    <Sparkles className="w-4 h-4 text-indigo-500" />
                  </div>
                  <span className="text-[11px] text-muted-foreground mt-2">
                    Redirect to Stripe checkout page
                  </span>
                </button>
              </div>

              {paymentMethod === "card" && (
                <div className="space-y-4 pt-2">
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-semibold text-foreground">Card Number</label>
                      <div className="flex gap-1.5">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => handleTestCardFill("4242 4242 4242 4242")}
                          className="text-[10px] font-mono h-6 px-2 text-emerald-600 bg-emerald-500/10 hover:bg-emerald-500/20"
                        >
                          Success (4242)
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => handleTestCardFill("4000 0000 0000 0002")}
                          className="text-[10px] font-mono h-6 px-2 text-rose-600 bg-rose-500/10 hover:bg-rose-500/20"
                        >
                          Decline (0002)
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => handleTestCardFill("4000 0025 0000 3155")}
                          className="text-[10px] font-mono h-6 px-2 text-blue-600 bg-blue-500/10 hover:bg-blue-500/20"
                        >
                          3DS (3155)
                        </Button>
                      </div>
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        required
                        value={cardNumber}
                        onChange={(e) => setCardNumber(e.target.value)}
                        placeholder="4242 4242 4242 4242"
                        className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                      <CreditCard className="w-4 h-4 text-muted-foreground absolute right-3 top-3 pointer-events-none" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-foreground">Expires (MM/YY)</label>
                      <input
                        type="text"
                        required
                        value={cardExpiry}
                        onChange={(e) => setCardExpiry(e.target.value)}
                        placeholder="MM/YY"
                        className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-foreground">Security Code (CVC)</label>
                      <input
                        type="text"
                        required
                        value={cardCvc}
                        onChange={(e) => setCardCvc(e.target.value)}
                        placeholder="CVC"
                        className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {paymentMethod === "stripe_hosted" && (
                <div className="p-4 rounded-xl border border-indigo-500/30 bg-indigo-50/50 dark:bg-indigo-950/20 text-xs space-y-2">
                  <div className="font-semibold text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-indigo-500" />
                    <span>Hosted Stripe Checkout</span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    You will be securely redirected to Stripe&apos;s hosted checkout to complete payment with Apple Pay, Google Pay, or Credit/Debit card. Your order will immediately return to your customer portal upon completion.
                  </p>
                </div>
              )}
            </CardContent>

            <CardFooter className="pt-2 flex flex-col gap-3">
              <Button
                type="submit"
                disabled={isProcessing}
                className="w-full h-12 text-base font-semibold shadow-glow"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing Payment...
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4 mr-2" />
                    Pay {pricing.formatted.total} & Place Order
                  </>
                )}
              </Button>

              <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground font-mono">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                <span>Zero Recurring Billing · Transactional Single Payment · GST Invoice Generated</span>
              </div>
            </CardFooter>
          </Card>
        </div>

        {/* Right Column: Order Summary & Production Specs */}
        <div className="lg:col-span-5 space-y-6">
          <Card className="bg-industrial-950 text-white border-industrial-800">
            <CardHeader className="pb-4 border-b border-industrial-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase text-industrial-400">Order Summary</span>
                <Badge variant="default" className="bg-emerald-600 text-[10px] font-mono">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Proof v{draft.proofVersion} Approved
                </Badge>
              </div>
              <CardTitle className="text-xl text-white">{product.name}</CardTitle>
              <CardDescription className="text-xs text-industrial-300">
                Division: {divisionName}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4 pt-4 text-xs font-mono">
              <div className="p-3 rounded-lg bg-industrial-900 border border-industrial-800 space-y-2">
                <div className="flex justify-between text-industrial-300">
                  <span>Target Dimensions:</span>
                  <span className="text-white font-semibold">
                    {draft.options.widthMm}mm × {draft.options.heightMm}mm
                  </span>
                </div>
                <div className="flex justify-between text-industrial-300">
                  <span>Material Substrate:</span>
                  <span className="text-white font-semibold">{pricing.materialName}</span>
                </div>
                <div className="flex justify-between text-industrial-300">
                  <span>Order Quantity:</span>
                  <span className="text-brand-400 font-bold">{draft.quantity} units</span>
                </div>
                <div className="flex justify-between text-industrial-300">
                  <span>Calculated Area:</span>
                  <span className="text-white font-semibold">{pricing.areaSqCm.toFixed(1)} cm² / unit</span>
                </div>
                {pricing.discountPercentage > 0 && (
                  <div className="flex justify-between text-emerald-400 font-bold pt-1 border-t border-industrial-800">
                    <span>Volume Discount:</span>
                    <span>-{pricing.discountPercentage}% Floor Applied</span>
                  </div>
                )}
                {approvedProof && (
                  <div className="pt-2 border-t border-industrial-800 text-[10px] text-industrial-400 space-y-0.5">
                    <div>Proof SHA-256 Hash:</div>
                    <div className="truncate text-brand-300">{approvedProof.sha256Hash}</div>
                  </div>
                )}
              </div>

              {/* Price Breakdown */}
              <div className="space-y-2 pt-2">
                <div className="flex justify-between text-industrial-400">
                  <span>Unit Rate (excl. GST):</span>
                  <span className="text-white">{pricing.formatted.unitPrice}</span>
                </div>
                <div className="flex justify-between text-industrial-400">
                  <span>Subtotal (Net):</span>
                  <span className="text-white font-semibold">{pricing.formatted.subtotal}</span>
                </div>
                <div className="flex justify-between text-industrial-400">
                  <span>GST ({pricing.gstRatePercentage}%):</span>
                  <span className="text-white font-semibold">{pricing.formatted.tax}</span>
                </div>
                <div className="flex justify-between text-base font-bold text-white pt-3 border-t border-industrial-800">
                  <span>Total Amount Due:</span>
                  <span className="text-brand-400 text-xl font-heading">{pricing.formatted.total}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Technical Production Guarantee */}
          <div className="p-4 rounded-xl border border-border bg-card text-xs space-y-2.5 font-mono">
            <div className="font-semibold text-foreground flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-brand-500" />
              <span>Automated Production Pipeline</span>
            </div>
            <div className="text-muted-foreground space-y-1.5 text-[11px] leading-relaxed">
              <div>• <strong>Stage 1 (ORDER):</strong> Payment verified and recorded in ERP ledger.</div>
              <div>• <strong>Stage 2 (ARTWORK):</strong> Server generates locked 300 DPI vector PDF.</div>
              <div>• <strong>Stage 3 (RIP & PRINT):</strong> Trim box +{product.default_bleed_mm}mm bleed sent to printers.</div>
              <div>• <strong>Accounting:</strong> Automated Xero ACCREC invoice created (Net 14).</div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-sm font-mono">Loading checkout session...</div>}>
      <CheckoutContent />
    </Suspense>
  );
}
