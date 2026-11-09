/* eslint-disable @next/next/no-img-element -- the site is a static export, which next/image cannot optimize; these are small dithered PNGs already. */
import { LandingInstall } from "./landing-install";
import { LandingPromo } from "./landing-promo";
import s from "./landing.module.css";

// Published under the site's base path, like the demo blueprints beside it.
const img = (name: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/images/night-${name}.png`;

/**
 * The first screen, drawn as a sheet of notes: the claim set in light type,
 * and down the left a grid with a hand
 * reaching for the first step, as the reader will.
 */
export function LandingCover() {
  return (
    <section id="install" className={s.cover} aria-labelledby="cover-title">
      <div className={s.plate} aria-hidden>
        <div className={s.note}>
          <Rows />
          <p>A blueprint of any repository, drawn from its own code.</p>
          <p>
            &mdash; every sentence <span className={s.ring2}>checked</span> against the lines it cites.
          </p>
        </div>
        <img className={s.hand} src={img("hand-edge")} alt="" />
        <figure className={s.window}>
          <figcaption>
            ENIAC, 1946 <i>×</i>
          </figcaption>
          <img src={img("eniac")} alt="" />
        </figure>
        <Globe />
      </div>

      <div className={s.claim}>
        <h1 id="cover-title" className={s.coverTitle}>
          Understand the code{" "}
          <span className={s.boxed}>
            you didn&rsquo;t write.<small>written by an agent</small>
          </span>
        </h1>
        <p className={s.coverSub}>
          Blueprint splits a repository into the steps the program takes. Click a step to open its parts, and keep
          going until you reach the code.
        </p>
        <div className={s.card}>
          <LandingInstall />
          <LandingPromo>
            <a className={s.promo} href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/promotion`}>
              Free Claude Code, unlimited blueprints (fair use), for a limited time <span aria-hidden>→</span>
            </a>
          </LandingPromo>
        </div>
      </div>

      <div className={s.coverFoot}>
        <a className={s.down} href="#app">
          Scroll to open the app <span aria-hidden>↓</span>
        </a>
      </div>
    </section>
  );
}

/** A blueprint's steps, small: one picked. */
function Rows() {
  return (
    <svg className={s.rows} viewBox="0 0 104 22" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={i * 21 + 0.5} y={0.5} width={19} height={9} className={i === 1 ? s.fill : undefined} />
      ))}
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={i * 21 + 0.5} y={12.5} width={19} height={9} className={i === 3 ? s.fill : undefined} />
      ))}
    </svg>
  );
}

function Globe() {
  return (
    <svg className={s.globe} viewBox="0 0 100 100" aria-hidden>
      <circle cx="50" cy="50" r="48" />
      <ellipse cx="50" cy="50" rx="20" ry="48" />
      <ellipse cx="50" cy="50" rx="38" ry="48" />
      <path d="M2 50H98M8 28H92M8 72H92" />
    </svg>
  );
}
