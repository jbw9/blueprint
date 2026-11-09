import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Zilla_Slab } from "next/font/google";
import s from "@/components/landing.module.css";
import { LandingVisit } from "@/components/landing-visit";
import p from "./promotion.module.css";
import { PromotionEnd } from "./promotion-end";

export const metadata: Metadata = {
  title: "Blueprint promotion: free Claude Code",
  description: "What Blueprint's free Claude Code promotion includes, how much each person gets, how it may be used, and when it ends.",
  alternates: { canonical: "/promotion" },
};

// The landing page's faces (app/page.tsx), so this reads as the same sheet.
const display = Zilla_Slab({ variable: "--font-display", subsets: ["latin"], weight: ["300", "400", "500"], display: "swap" });
const sans = IBM_Plex_Sans({ variable: "--font-body", subsets: ["latin"], display: "swap" });
const mono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * The promotion's terms, linked under the install command (components/landing-cover.tsx) and from
 * Blueprint's Settings. The numbers are the proxy's defaults (app/scripts/api/credit.mjs, DEFAULTS):
 * change them there and here together.
 */
export default function Promotion() {
  return (
    <div className={`${s.page} ${display.variable} ${sans.variable} ${mono.variable}`}>
      <div className={s.paper}>
        <main className={p.sheet}>
          <a className={p.back} href={`${BASE}/`}>
            <span aria-hidden>←</span> blpr.dev
          </a>
          <h1>Claude Code, free in Blueprint</h1>
          <p className={p.lede}>
            For a limited time, Blueprint pays for the Claude behind it. Making blueprints is unlimited, within fair use. Claude Code in Blueprint&rsquo;s tabs gets about
            half of a Claude Pro plan.
          </p>
          <p className={p.note}>
            <PromotionEnd />
          </p>

          <h2>What each person gets</h2>
          <table className={p.table}>
            <thead>
              <tr>
                <th>What</th>
                <th>Allowance</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Making blueprints</td>
                <td>
                  Unlimited, within fair use: up to $100 of Claude a week per account, about eight blueprints of mid-size codebases. New blueprints and
                  their updates both count. Past that, new blueprints run on your own Claude Code until the week resets.
                </td>
              </tr>
              <tr>
                <td>Claude tabs, per session</td>
                <td>About half of a Claude Pro session, usually 15&ndash;40 prompts. The 5 hours start with your first message.</td>
              </tr>
              <tr>
                <td>Claude tabs, per week</td>
                <td>About ten full sessions. The week starts with your first message.</td>
              </tr>
            </tbody>
          </table>
          <p className={p.fine}>
            It works like Claude Code&rsquo;s own plans: a 5-hour session and a weekly limit. How many prompts fit depends on the work. Large codebases,
            long conversations and many files read in one turn use more. Claude tabs run Claude Sonnet, or Claude Haiku when Claude Code asks for it; a
            request for Opus runs on Sonnet. Settings → Blueprint credit shows how much of the session and the week you have used, and when each resets.
          </p>

          <h2>Who can use it</h2>
          <ul>
            <li>Anyone with Blueprint installed and a GitHub account at least 30 days old. Sign in with GitHub in Settings → Blueprint credit.</li>
            <li>One allowance per GitHub account, on up to two computers.</li>
            <li>You don&rsquo;t need a Claude plan to use it.</li>
          </ul>

          <h2>How it may be used</h2>
          <ul>
            <li>Only inside Blueprint: its Claude tabs and its own blueprint generation. The credit doesn&rsquo;t work outside the app.</li>
            <li>Don&rsquo;t share your sign-in, resell access, run automated workloads on it, or use more than one account to get more.</li>
            <li>An account can run up to three Claude tab requests at once. Spending very fast slows requests down for a minute.</li>
            <li>Accounts that misuse the credit can lose it without notice.</li>
          </ul>

          <h2>When it runs out</h2>
          <ul>
            <li>
              With <em>Switch to my Claude Code when it runs out</em> checked in Settings, which is the default, a Claude tab that hits its limit picks up the
              same conversation on your own Claude Code. You don&rsquo;t have to sign in again. New tabs go back to Blueprint credit once it resets.
            </li>
            <li>If you don&rsquo;t have Claude Code signed in with a plan of your own, Claude tabs wait until the session or the week resets.</li>
            <li>If the promotion&rsquo;s budget for the whole month is used up, the credit pauses for everyone until the 1st of the next month.</li>
          </ul>

          <h2>When it ends</h2>
          <p>
            The promotion is for a limited time. Blueprint can change these allowances, or end the promotion, at any time. The end date is shown at the top
            of this page and in Settings. After it ends, Blueprint runs on your own Claude Code, as it does without the promotion.
          </p>

          <h2>Your data</h2>
          <p>
            Requests go from Blueprint to Blueprint&rsquo;s server, which sends them to Claude on Amazon Bedrock. To enforce the limits, Blueprint keeps each
            request&rsquo;s token counts, its cost and a coarse network for 30 days. It doesn&rsquo;t keep what you or Claude wrote. Blueprints stay on your
            computer.
          </p>
        </main>
      </div>
      <LandingVisit />
    </div>
  );
}
