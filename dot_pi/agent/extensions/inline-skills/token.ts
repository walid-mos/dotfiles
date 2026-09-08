/**
 * Single source of truth for the `/skill:` token shape.
 *
 * A token is `/skill:` + an optional (partially typed) skill-name prefix,
 * always preceded by whitespace or line-start. Every module here matches
 * against this shape — never redefine it locally.
 */
export const SKILL_TOKEN_RE = /(?:^|\s)(\/skill:([a-z0-9-]*))$/;

/** Global variant for finding every token in a full prompt. */
export const SKILL_TOKEN_GLOBAL_RE = /(?:^|\s)\/skill:([a-z0-9-]+)/g;

/** The literal token text for a skill name: "/skill:name". */
export function skillToken(skillName: string): string {
	return `/skill:${skillName}`;
}

/** Is the cursor inside a `/skill:` token (possibly unfinished)? */
export function isSkillTokenContext(textBeforeCursor: string): boolean {
	return SKILL_TOKEN_RE.test(textBeforeCursor);
}
