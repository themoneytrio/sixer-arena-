import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { prisma } from "../db.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireVenueMember: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    userId?: string;
  }
}

export default fp(async (app) => {
  await app.register(jwt, { secret: config.jwtSecret });

  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await req.jwtVerify<{ sub: string }>();
      req.userId = payload.sub;
    } catch {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  // Authorization = a VenueMembership row for :venueId (OWNER or MANAGER).
  app.decorate("requireVenueMember", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await req.jwtVerify<{ sub: string }>();
      req.userId = payload.sub;
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const venueId = (req.params as any).venueId;
    const member = await prisma.venueMembership.findFirst({ where: { userId: req.userId, venueId } });
    if (!member) reply.code(403).send({ error: "forbidden" });
  });
}, { name: "auth" });
