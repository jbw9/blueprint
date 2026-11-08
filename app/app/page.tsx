import { Suspense } from "react";
import { Acts } from "@/components/agent/acts";
import { Canvas } from "@/components/blueprint/canvas";
import { DiffMode } from "@/components/review/diff";
import { DiffPanel } from "@/components/review/diff-panel";
import { FilesPanel } from "@/components/blueprint/files";
import { BlueprintProvider } from "@/components/blueprint/blueprint-context";
import { ProjectsDialog } from "@/components/projects/projects";
import { AuditDialog } from "@/components/blueprint/audit";
import { HistoryDialog } from "@/components/review/additions";
import { SettingsDialog } from "@/components/chrome/settings";
import { Copied } from "@/components/chrome/copied";
import { MenuBar } from "@/components/chrome/menubar";
import { Dictation } from "@/components/chrome/dictation";
import { Titlebar } from "@/components/chrome/titlebar";
import { Workspace } from "@/components/agent/workspace";
import { NoProject } from "@/components/chrome/welcome";
import { Palette } from "@/components/chrome/palette";
import { StatusBar } from "@/components/chrome/statusbar";
import { ReviewTray } from "@/components/review/review-tray";
import { DagreDiagrams } from "@/components/blueprint/dagre-style";
import { listBlueprints, loadDemo, loadBlueprint, remoteOf, rootOf } from "@/lib/server/blueprints";
import { STATIC_BLUEPRINT } from "@/lib/blueprint/source";
import type { Progress } from "@/lib/server/vault";

// The open level lives in the URL, and `useSearchParams` needs a Suspense
// boundary to prerender. `?blueprint=` picks which repository's blueprint is read. In the
// desktop app the title bar sits above the blueprint and the status bar under it;
// the workspace (Claude Code and terminal tabs) floats over the blueprint's right.
// All of them live inside the provider, so they know which blueprint (and checkout)
// is open. `?none`, a project that is gone, or no project at all is the
// blank page instead (components/chrome/welcome.tsx).
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // A static export serves one blueprint and must not read the request.
  const asked = STATIC_BLUEPRINT ?? (await searchParams).blueprint;
  // The landing page frames one blueprint at a time and switches between them itself.
  const embed = !STATIC_BLUEPRINT && (await searchParams).embed !== undefined;
  const wanted = typeof asked === "string" ? asked : undefined;
  const none = !STATIC_BLUEPRINT && !embed && (await searchParams).none !== undefined;
  // A project asked for by name and since deleted is not quietly swapped for
  // another one: the window shows the blank page.
  const gone = !STATIC_BLUEPRINT && !embed && wanted !== undefined && !listBlueprints().some((m) => m.id === wanted);
  // The landing frames only its own demos (D63), never one of this machine's
  // projects; a static export is a demo or a project.
  const open = none || gone ? null : embed ? loadDemo(wanted) : (STATIC_BLUEPRINT ? loadDemo(wanted) : null) ?? loadBlueprint(wanted);
  if (!open)
    return (
      <div className="flex h-full flex-col">
        <Titlebar bare />
        <NoProject blueprints={listBlueprints()} />
        <SettingsDialog />
        <ProjectsDialog />
        <MenuBar />
      </div>
    );
  const { name, file } = open;
  // Only a project of the reader's has one: its blueprint follows its file as it is rewritten.
  const version = "version" in open ? (open.version as string | undefined) : undefined;
  // A project's blueprint still being made carries how far its run has got (D69).
  const progress = "progress" in open ? (open.progress as Progress | undefined) : undefined;
  file.RUN.url ??= remoteOf(file.RUN);
  // A published page has no checkout to read, and must not carry this machine's paths.
  // The desktop app's tabs start in the checkout, so it is named in full.
  if (STATIC_BLUEPRINT) delete file.RUN.root;
  else file.RUN.root = rootOf(file.RUN);
  return (
    <BlueprintProvider name={name} file={file} version={version} progress={progress} blueprints={STATIC_BLUEPRINT || embed ? [{ id: name, label: name, local: false }] : listBlueprints()}>
      <DagreDiagrams on={embed || Boolean(STATIC_BLUEPRINT)}>
      <div className="flex h-full flex-col">
        {/* Keyed by blueprint: a switch starts fresh, never mid-transition from the
            old tree. Around the title bar too, whose version-control button
            shows when a change is on. */}
        <DiffMode key={name} blueprint={name}>
          {/* The title bar reads the open level from the URL, as the blueprint does. */}
          <Suspense>
            <Titlebar />
          </Suspense>
          <div className="relative min-h-0 flex-1">
            <Suspense>
              <Canvas key={name} />
              {/* Inside the provider: the panel is the diff's own list, and
                  what Claude shows needs both the blueprint and the diff's range. */}
              <DiffPanel />
              <FilesPanel />
              <Acts />
              <ReviewTray />
            </Suspense>
          </div>
        </DiffMode>
        <Suspense>
          {STATIC_BLUEPRINT ? null : <Workspace />}
        </Suspense>
        {/* A static export is only ever a landing demo, framed like an embed. */}
        {embed || STATIC_BLUEPRINT ? null : <StatusBar />}
        <Suspense>
          <Palette />
        </Suspense>
        <SettingsDialog />
        {STATIC_BLUEPRINT ? null : <Dictation />}
        {STATIC_BLUEPRINT ? null : <Copied />}
        <ProjectsDialog />
        <HistoryDialog />
        <AuditDialog />
        {STATIC_BLUEPRINT ? null : <MenuBar />}
      </div>
      </DagreDiagrams>
    </BlueprintProvider>
  );
}
