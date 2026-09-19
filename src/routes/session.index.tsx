import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { BigButton, Card, FooterNote, Page } from "@/components/ckd/ui";
import { supabase } from "@/integrations/supabase/client";
import { makeCode } from "@/lib/ckd-db";
import { forgetDeviceSession, getDeviceSession, rememberDeviceSession } from "@/lib/session-device";

export const Route = createFileRoute("/session/")({
  validateSearch: (search: Record<string, unknown>): { language: "zh" | "hokkien" | "en" } => ({
    language:
      search["language"] === "en" ? "en" : search["language"] === "hokkien" ? "hokkien" : "zh",
  }),
  head: () => ({ meta: [{ title: "开始对话 · Start a conversation" }] }),
  component: StartConversation,
});

function StartConversation() {
  const { language } = Route.useSearch();
  const navigate = useNavigate();
  const [savedCode, setSavedCode] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    setSavedCode(getDeviceSession());
    setReady(true);
  }, []);

  const open = async (resume: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      let code = resume ? savedCode : null;
      if (code) {
        const { data, error } = await supabase
          .from("ckd_sessions")
          .select("id")
          .eq("code", code)
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          forgetDeviceSession();
          setSavedCode(null);
          toast.error(
            "找不到之前的对话，请开始新对话。 · Your saved conversation is unavailable. Please start a new one.",
          );
          return;
        }
        const { error: updateError } = await supabase
          .from("ckd_sessions")
          .update({ language })
          .eq("id", data.id);
        if (updateError) throw updateError;
      } else {
        // Retry the unique code if another session already uses it.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const candidate = makeCode();
          const { error } = await supabase.from("ckd_sessions").insert({
            code: candidate,
            patient_label: "Patient",
            language,
            stage: "checkin",
            consent_recording: false,
            consent_sharing: false,
          });
          if (!error) {
            code = candidate;
            break;
          }
          if (error.code !== "23505" || attempt === 2) throw error;
        }
      }
      if (!code) throw new Error("Could not create conversation");
      setSavedCode(code);
      if (!rememberDeviceSession(code)) {
        toast.warning(
          "This browser cannot remember your conversation. Bookmark the conversation page to return to it.",
        );
      }
      await navigate({ to: "/session/$code", params: { code } });
    } catch {
      toast.error("无法打开对话，请重试。 · Could not open the conversation. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Page>
      <div className="space-y-6">
        <h1 className="text-3xl font-semibold text-foreground">
          谈谈您在意的事 · Let’s talk about what matters to you
        </h1>
        <p className="text-lg text-muted-foreground">
          {language === "en"
            ? "English"
            : language === "hokkien"
              ? "福建话 · Hokkien"
              : "华语 · Mandarin Chinese"}
        </p>
        <Card className="space-y-5">
          {savedCode ? (
            <BigButton disabled={!ready || busy} onClick={() => void open(true)}>
              继续对话 · Continue conversation
            </BigButton>
          ) : null}
          <BigButton
            variant={savedCode ? "ghost" : "primary"}
            disabled={!ready || busy}
            onClick={() => void open(false)}
          >
            {busy ? "正在打开… Opening…" : "开始新对话 · Start conversation"}
          </BigButton>
          <p className="text-sm text-muted-foreground">
            Your answers are saved as you go. Return using this browser on this device to continue.
            {savedCode
              ? " Starting a new conversation replaces the one remembered on this device."
              : ""}
          </p>
        </Card>
        <Link to="/" className="block font-semibold text-primary underline">
          更换语言 · Change language
        </Link>
        <FooterNote />
      </div>
    </Page>
  );
}
