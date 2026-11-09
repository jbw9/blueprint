import { LandingPromo } from "./landing-promo";
import s from "./landing.module.css";

const QUESTIONS = [
  {
    q: "Is this an IDE?",
    a: "Yes, the next one: you read your repository as a blueprint instead of line by line, and it's built so you can hand an agent context in a click and the agent finds the rest itself.",
  },
  {
    q: "Do I still need my editor?",
    a: "Keep it if you like; any line in the blueprint opens there.",
  },
  {
    q: "How does it work with agents?",
    a: "Pick any section, box or line and it goes to Claude as context, and Claude reads the blueprint to find the code it needs.",
  },
  {
    q: "Does my code leave my computer?",
    a: "Only to your own Claude Code, as it would anyway; the blueprint stays on your machine.",
  },
  {
    q: "What do I need?",
    a: "A Mac or Linux desktop and Claude Code on a Claude plan.",
  },
  {
    q: "What does it cost?",
    a: (
      <>
        Making a blueprint uses your Claude plan, like any Claude Code session.
        <LandingPromo>
          {" "}
          For a limited time, sign in with GitHub in settings and it runs on Blueprint&rsquo;s Claude instead (
          <a href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/promotion`}>the terms</a>).
        </LandingPromo>
      </>
    ),
  },
  {
    q: "Which languages does it read?",
    a: "TypeScript, Python, Go, Rust, Java, Swift and most other major languages, plus SQL, Prisma, GraphQL and protobuf.",
  },
  {
    q: "What's proven and what's a guess?",
    a: "Solid lines came from the code; dashed lines and cards marked inferred didn't.",
  },
  {
    q: "What happens when the code changes?",
    a: "Only the sections whose code changed are redone; the rest stays put.",
  },
];

/** What people ask before they blueprint their own repository. */
export function LandingStart() {
  return (
    <section id="questions" className={s.section} aria-labelledby="questions-title">
      <h2 id="questions-title" className={s.reveal}>Questions.</h2>
      <div className={`${s.faq} ${s.reveal}`}>
        {QUESTIONS.map(({ q, a }) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
