/**
 * Stands in for a screen that has not been built yet.
 *
 * It names the task that will replace it, so an unfinished screen reached during a rehearsal is
 * self-explanatory rather than mysterious.
 */
export function PlaceholderScreen({ title, beat }: { title: string; beat?: number }) {
  return (
    <section className="state">
      <span className="state__title">{title}</span>
      <p className="state__detail">
        Not yet implemented.
        {beat !== undefined && ` This screen serves demo beat ${beat}.`}
      </p>
    </section>
  );
}
