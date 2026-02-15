import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export default function MealCompatibility() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe) {
      iframe.addEventListener("load", () => setLoading(false));
    }
    return () => {
      if (iframe) {
        iframe.removeEventListener("load", () => setLoading(false));
      }
    };
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-white">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/patient/dashboard")}
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Dashboard
        </Button>
        <div className="h-5 w-px bg-border" />
        <h1 className="text-lg font-semibold text-foreground">
          Food Compatibility Intelligence Engine
        </h1>
      </div>
      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900 z-10">
            <div className="text-center space-y-3">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-cyan-400 mx-auto" />
              <p className="text-cyan-400 text-sm">
                Loading Compatibility Engine...
              </p>
            </div>
          </div>
        )}
        <iframe
          ref={iframeRef}
          src="/compatibility.html"
          className="w-full h-full border-0"
          title="Food Compatibility Intelligence Engine"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope"
        />
      </div>
    </div>
  );
}
