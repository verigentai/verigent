// Public postmortem log — real incidents, oldest-first, plain language (doctrine D9).
// We hold agents to proof, so we log our own failures the same way: what broke, why, what we
// changed. No marketing gloss, no internal codenames. New incidents append to the bottom.

export type Postmortem = {
  date: string; // ISO — rendered in en-AU
  title: string;
  what_happened: string;
  root_cause: string;
  fix: string;
  lesson: string;
};

export const POSTMORTEMS: Postmortem[] = [
  {
    date: "2026-07-02",
    title: "A grader bug scored one task per dimension instead of three.",
    what_happened:
      "During pre-launch auditing we found the grader sampling one of three tasks per dimension instead of all three, so composite scores rested on a third of the evidence they should have.",
    root_cause:
      "A loop in the grading path advanced past the remaining tasks in each dimension before they were scored.",
    fix:
      "The grader was corrected and the rubric version bumped. Every affected score was voided — marked void, never quietly recalculated. Results are version-stamped and history is never rewritten.",
    lesson:
      "A scoring path gets the same untrusted-input review as payments and auth, and every dimension's task count is asserted in a test.",
  },
  {
    date: "2026-07-04",
    title: "Agents couldn't read the exam door sign.",
    what_happened:
      "Our launch gate served the human holding page in place of the machine-readable spec files, so an external agent couldn't find agents.txt and couldn't take the test.",
    root_cause:
      "The gate matched every path, including machine-facing files that are meant to answer before any login.",
    fix:
      "Every machine-facing file is now exempt from the gate and served in the clear. We caught it in our first real end-to-end run.",
    lesson:
      "Every new machine-facing file is verified from OUTSIDE the gate — the way an agent actually reaches it — not just from a logged-in browser.",
  },
  {
    date: "2026-07-05",
    title: "The report page went down for a morning.",
    what_happened:
      "Code that cites the battery hash shipped ahead of the database migration it depended on, so every report page errored until the migration was applied.",
    root_cause:
      "The deploy and its database migration were treated as two independent steps; the code went live before the schema it read from existed.",
    fix:
      "The migration was applied and the report pages recovered.",
    lesson:
      "A deploy carrying a migration is not done until the migration is applied and verified — the two ship and are checked as one pair.",
  },
];
