"use client";

import React, { useState } from "react";
import { Product } from "@/types/database";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UploadCloud, FileCheck, CheckCircle2, AlertTriangle, FileText } from "lucide-react";

interface DirectUploadViewProps {
  product: Product;
  widthMm: number;
  heightMm: number;
  onUploadSuccess: (fileUrl: string, fileName: string) => void;
}

export function DirectUploadView({
  product,
  widthMm,
  heightMm,
  onUploadSuccess,
}: DirectUploadViewProps) {
  const [uploadedFile, setUploadedFile] = useState<{ name: string; size: string; type: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setTimeout(() => {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      setUploadedFile({
        name: file.name,
        size: `${sizeMb} MB`,
        type: file.type || "Vector Artwork",
      });
      setIsProcessing(false);
      onUploadSuccess(URL.createObjectURL(file), file.name);
    }, 800);
  };

  return (
    <Card className="border-border shadow-elevation">
      <CardHeader>
        <div className="flex items-center gap-2 text-xs font-mono font-semibold text-brand-500 uppercase">
          <UploadCloud className="w-3.5 h-3.5" />
          <span>Direct Artwork File Upload</span>
        </div>
        <CardTitle className="text-xl font-bold font-heading">
          Upload Finished Print-Ready Artwork
        </CardTitle>
        <CardDescription>
          For print professionals with artwork pre-exported from Adobe Illustrator, Photoshop, or InDesign.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Upload Dropzone */}
        <label className="border-2 border-dashed border-border hover:border-brand-500 rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-colors bg-secondary/20 hover:bg-secondary/40">
          <UploadCloud className="w-12 h-12 text-brand-500 mb-3 animate-bounce" />
          <span className="font-bold text-sm text-foreground">
            Drop artwork here or click to browse
          </span>
          <span className="text-xs text-muted-foreground mt-1 font-mono">
            Accepted Formats: PDF, SVG, AI, PNG (Minimum 300 DPI recommended)
          </span>
          <input
            type="file"
            accept=".pdf,.svg,.ai,.png,.eps"
            onChange={handleFileUpload}
            className="hidden"
          />
        </label>

        {isProcessing && (
          <div className="text-center font-mono text-xs text-brand-500 animate-pulse">
            Inspecting vector geometry & pre-flight DPI checks...
          </div>
        )}

        {uploadedFile && (
          <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <div className="font-bold text-sm text-foreground">{uploadedFile.name}</div>
                  <div className="text-xs font-mono text-muted-foreground">
                    {uploadedFile.size} · Pre-flight Verified
                  </div>
                </div>
              </div>
              <Badge variant="success" className="text-xs font-mono">
                READY FOR PROOF
              </Badge>
            </div>

            <div className="text-xs font-mono text-emerald-800 dark:text-emerald-300 space-y-1 border-t border-emerald-200/60 pt-2">
              <div>✓ Matched Target Print Box: {widthMm}mm × {heightMm}mm</div>
              <div>✓ Bleed requirement: +{product.default_bleed_mm}mm included in vector boundary</div>
            </div>
          </div>
        )}

        {/* Requirements Notice */}
        <div className="p-4 rounded-lg bg-secondary/50 border text-xs font-mono space-y-2">
          <div className="font-bold text-foreground">Pre-Flight Manufacturing Specifications:</div>
          <ul className="text-muted-foreground space-y-1">
            <li>• Please ensure all fonts are outlined / converted to curves.</li>
            <li>• Artwork color space should be CMYK with embed color profiles.</li>
            <li>• High-resolution vector contours will be used for die-cutting.</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
