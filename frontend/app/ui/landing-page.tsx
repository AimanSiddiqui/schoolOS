"use client";

import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  ClipboardCheck,
  Pause,
  Play,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Brand } from "./brand";

const perspectives = {
  Administrators: {
    title: "A school in sync starts here.",
    copy: "Keep student records, class structures, and daily registers connected in one school workspace.",
    items: [
      "Student and guardian records",
      "Academic years and class setup",
      "School-wide attendance",
    ],
  },
  Teachers: {
    title: "A little less admin. A little more teaching.",
    copy: "Open your assigned sections, record daily attendance, and keep the register up to date.",
    items: ["Assigned section rosters", "Daily attendance marking", "Finalization and corrections"],
  },
  Guardians: {
    title: "The right information. For the right family.",
    copy: "Access school records for children explicitly linked to your account, with privacy built into every view.",
    items: ["Authorized child records", "School-specific access", "Private family information"],
  },
};

export function LandingPage() {
  const landingRef = useRef<HTMLElement>(null);
  const [perspective, setPerspective] = useState<keyof typeof perspectives>("Administrators");
  const [heroPaused, setHeroPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    const root = landingRef.current;
    if (!root || typeof window.matchMedia !== "function") return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    let observer: IntersectionObserver | null = null;
    function configureMotion() {
      if (!root) return;
      setReducedMotion(preference.matches);
      observer?.disconnect();
      if (preference.matches || !("IntersectionObserver" in window)) {
        delete root.dataset.motion;
        for (const target of targets) target.dataset.revealState = "visible";
        return;
      }
      root.dataset.motion = "ready";
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              (entry.target as HTMLElement).dataset.revealState = "visible";
              observer?.unobserve(entry.target);
            }
          }
        },
        { threshold: 0.12, rootMargin: "0px 0px -32px 0px" },
      );
      for (const target of targets) {
        if (
          target.dataset.revealState === "visible" ||
          target.getBoundingClientRect().top < window.innerHeight - 32
        ) {
          target.dataset.revealState = "visible";
        } else {
          target.dataset.revealState = "pending";
          observer.observe(target);
        }
      }
    }
    configureMotion();
    preference.addEventListener("change", configureMotion);
    return () => {
      observer?.disconnect();
      preference.removeEventListener("change", configureMotion);
    };
  }, []);
  const content = perspectives[perspective];
  return (
    <section ref={landingRef} className="landing-page" aria-labelledby="landing-heading">
      <header className="landing-header">
        <Brand />
        <nav aria-label="Public navigation">
          <a href="#workspace">Workspace</a>
          <a href="#school-life">School life</a>
        </nav>
        <div className="landing-header-actions">
          <Link className="login-link" href="/login">
            Login
          </Link>
          <Link className="primary-button" href="/signup">
            Sign up
            <ArrowRight size={16} />
          </Link>
        </div>
      </header>
      <section className="landing-hero" data-hero-paused={heroPaused || reducedMotion}>
        <Image
          src="/campus.jpg"
          alt="Graduates celebrating together outdoors"
          fill
          priority
          sizes="100vw"
          className="hero-photo"
        />
        <div className="hero-content">
          <p className="eyebrow">A connected school day</p>
          <h1 id="landing-heading">SchoolOS</h1>
          <p className="hero-statement">
            <span>More clarity.</span>
            <span>More room to grow.</span>
          </p>
          <p className="hero-description">
            The everyday home for your school&apos;s people, records, and attendance.
          </p>
          <div className="landing-actions">
            <Link className="primary-button" href="/login">
              Log in
              <ArrowRight size={17} />
            </Link>
            <a className="hero-secondary" href="#workspace">
              Explore the workspace
              <ArrowDown size={16} />
            </a>
          </div>
        </div>
        <span className="hero-caption">Built around people. Ready for the school day.</span>
        {!reducedMotion ? (
          <button
            className="hero-motion-control"
            type="button"
            aria-label={heroPaused ? "Resume background animation" : "Pause background animation"}
            title={heroPaused ? "Resume background animation" : "Pause background animation"}
            onClick={() => setHeroPaused((paused) => !paused)}
          >
            {heroPaused ? <Play size={17} /> : <Pause size={17} />}
          </button>
        ) : null}
      </section>
      <section id="school-life" className="landing-capabilities">
        <div data-reveal>
          <p className="eyebrow">Less scattered. More connected.</p>
          <h2>One home for the everyday.</h2>
        </div>
        <div className="capability-grid">
          <article data-reveal>
            <UsersRound size={26} />
            <h3>People & records</h3>
            <p>Students, guardians, and enrollment history, kept together.</p>
          </article>
          <article data-reveal>
            <BookOpen size={26} />
            <h3>Academic structure</h3>
            <p>Years, grade levels, sections, and teaching assignments.</p>
          </article>
          <article data-reveal>
            <ClipboardCheck size={26} />
            <h3>Daily attendance</h3>
            <p>A clear register, from the first mark to the final correction.</p>
          </article>
        </div>
      </section>
      <section id="workspace" className="landing-workspace">
        <div className="landing-section-heading" data-reveal>
          <div>
            <p className="eyebrow">Your school. In focus.</p>
            <h2>A calmer place to get things done.</h2>
          </div>
          <Link className="text-link" href="/dashboard">
            Open dashboard
            <ArrowRight size={17} />
          </Link>
        </div>
        <div className="product-image" data-reveal>
          <Image
            src="/workspace-preview.png"
            unoptimized
            alt="SchoolOS dashboard showing student records and daily attendance in a synthetic demo school"
            width={1440}
            height={980}
            sizes="(max-width: 760px) 100vw, 1180px"
          />
        </div>
      </section>
      <section className="landing-roles" data-reveal>
        <div className="role-switch" role="tablist" aria-label="School roles">
          {Object.keys(perspectives).map((role) => (
            <button
              key={role}
              id={`role-${role}`}
              type="button"
              role="tab"
              aria-selected={perspective === role}
              aria-controls="role-content"
              tabIndex={perspective === role ? 0 : -1}
              onClick={() => setPerspective(role as keyof typeof perspectives)}
              onKeyDown={(event) => {
                const roles = Object.keys(perspectives) as (keyof typeof perspectives)[];
                const index = roles.indexOf(perspective);
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  const next =
                    roles[
                      (index + (event.key === "ArrowRight" ? 1 : roles.length - 1)) % roles.length
                    ];
                  setPerspective(next);
                  document.getElementById(`role-${next}`)?.focus();
                }
              }}
            >
              {role}
            </button>
          ))}
        </div>
        <div
          key={perspective}
          id="role-content"
          role="tabpanel"
          aria-labelledby={`role-${perspective}`}
          className="role-content"
        >
          <div>
            <h2>{content.title}</h2>
            <p>{content.copy}</p>
          </div>
          <ul>
            {content.items.map((item) => (
              <li key={item}>
                <ShieldCheck size={18} />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <footer className="landing-footer">
        <Brand />
        <span>A better rhythm for the school day.</span>
        <Link href="/signup">
          Set up your school
          <ArrowRight size={16} />
        </Link>
      </footer>
    </section>
  );
}
