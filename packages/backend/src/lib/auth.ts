/**
 * Claims carried by the access token and exposed as `request.user` by
 * `@fastify/jwt`. Keep this minimal — anything else is loaded from the DB.
 */
export interface AccessTokenPayload {
  /** `users.id` */
  sub: string;
  email: string;
}
