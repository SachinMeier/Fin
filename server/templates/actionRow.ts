/**
 * Reusable Action Row component
 *
 * A horizontal row of action buttons, typically at the bottom of forms or cards.
 */

export interface ActionRowOptions {
  /** Buttons/links to render (HTML strings from renderButton/renderLinkButton) */
  actions: string[];
  /** Alignment: 'left', 'right', 'between' (space-between) */
  align?: "left" | "right" | "between";
}

export function renderActionRow({ actions, align = "right" }: ActionRowOptions): string {
  const justifyClass = {
    left: "justify-start",
    right: "justify-end",
    between: "justify-between",
  }[align];

  return `
    <div class="flex items-center gap-3 ${justifyClass}">
      ${actions.join("")}
    </div>
  `;
}
