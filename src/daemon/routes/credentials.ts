import type { CredentialManager } from "../../credentials/index.ts";
import { CredentialManagerError } from "../../credentials/index.ts";
import type { AuthContext } from "../auth-provider.ts";
import type { ErrorCode } from "../../types/index.ts";
import type { DaemonErrorResponse } from "../types.ts";

function errorResponse(
  code: ErrorCode,
  message: string,
  reason?: string,
  status = 500,
): Response {
  const body: DaemonErrorResponse = {
    success: false,
    error: { code, message, reason },
  };
  return Response.json(body, { status });
}

export async function handleCredentialRoutes(
  req: Request,
  url: URL,
  path: string,
  credentialManager: CredentialManager,
  authCtx: AuthContext | null,
): Promise<Response | null> {
  // GET /api/credentials -- list all credentials (redacted)
  if (path === "/api/credentials" && req.method === "GET") {
    const cfg = credentialManager.getRedactedConfig();
    return Response.json({ success: true, ...cfg });
  }

  // GET /api/credentials/resolve?userId=X&service=Y -- resolve effective credential
  if (path === "/api/credentials/resolve" && req.method === "GET") {
    const userId = url.searchParams.get("userId");
    const service = url.searchParams.get("service");
    if (!userId || !service) {
      return errorResponse("INPUT_VALIDATION_ERROR", "Missing 'userId' or 'service' query param", undefined, 400);
    }
    if (authCtx && authCtx.userId !== userId && authCtx.role !== "admin") {
      return errorResponse("AUTH_ERROR", "Agents can only resolve their own credentials", undefined, 403);
    }
    const resolved = credentialManager.resolve(userId, service);
    return Response.json({ success: true, userId, service, credential: resolved });
  }

  // POST /api/credentials -- set credential { identity, service, credential }
  if (path === "/api/credentials" && req.method === "POST") {
    try {
      const body = await req.json() as { identity: string; service: string; credential: unknown };
      if (!body.identity || !body.service || !body.credential) {
        return errorResponse("INPUT_VALIDATION_ERROR", "Missing 'identity', 'service', or 'credential' field", undefined, 400);
      }
      await credentialManager.setCredential(body.identity, body.service, body.credential);
      return Response.json({ success: true, message: `Credential set for '${body.identity}' on '${body.service}'` }, { status: 201 });
    } catch (err) {
      if (err instanceof CredentialManagerError) {
        return errorResponse("INPUT_VALIDATION_ERROR", err.message, undefined, 400);
      }
      return errorResponse("INTERNAL_ERROR", err instanceof Error ? err.message : String(err));
    }
  }

  // DELETE /api/credentials -- remove credential { identity, service }
  if (path === "/api/credentials" && req.method === "DELETE") {
    try {
      let body: { identity?: string; service?: string };
      try {
        body = await req.json() as { identity: string; service: string };
      } catch {
        return errorResponse("INPUT_VALIDATION_ERROR", "Malformed JSON body", undefined, 400);
      }
      if (!body.identity || !body.service) {
        return errorResponse("INPUT_VALIDATION_ERROR", "Missing 'identity' or 'service' field", undefined, 400);
      }
      await credentialManager.removeCredential(body.identity, body.service);
      return Response.json({ success: true, message: `Credential removed for '${body.identity}' on '${body.service}'` });
    } catch (err) {
      if (err instanceof CredentialManagerError) {
        return errorResponse("INPUT_VALIDATION_ERROR", err.message, undefined, 400);
      }
      return errorResponse("INTERNAL_ERROR", err instanceof Error ? err.message : String(err));
    }
  }

  // POST /api/credentials/defaults -- set default credential { service, credential }
  if (path === "/api/credentials/defaults" && req.method === "POST") {
    try {
      const body = await req.json() as { service: string; credential: unknown };
      if (!body.service || !body.credential) {
        return errorResponse("INPUT_VALIDATION_ERROR", "Missing 'service' or 'credential' field", undefined, 400);
      }
      await credentialManager.setDefault(body.service, body.credential);
      return Response.json({ success: true, message: `Default credential set for '${body.service}'` }, { status: 201 });
    } catch (err) {
      if (err instanceof CredentialManagerError) {
        return errorResponse("INPUT_VALIDATION_ERROR", err.message, undefined, 400);
      }
      return errorResponse("INTERNAL_ERROR", err instanceof Error ? err.message : String(err));
    }
  }

  // DELETE /api/credentials/defaults -- remove default { service }
  if (path === "/api/credentials/defaults" && req.method === "DELETE") {
    try {
      let body: { service?: string };
      try {
        body = await req.json() as { service: string };
      } catch {
        return errorResponse("INPUT_VALIDATION_ERROR", "Malformed JSON body", undefined, 400);
      }
      if (!body.service) {
        return errorResponse("INPUT_VALIDATION_ERROR", "Missing 'service' field", undefined, 400);
      }
      await credentialManager.removeDefault(body.service);
      return Response.json({ success: true, message: `Default credential removed for '${body.service}'` });
    } catch (err) {
      if (err instanceof CredentialManagerError) {
        return errorResponse("INPUT_VALIDATION_ERROR", err.message, undefined, 400);
      }
      return errorResponse("INTERNAL_ERROR", err instanceof Error ? err.message : String(err));
    }
  }

  // GET /api/credentials/groups -- list all groups
  if (path === "/api/credentials/groups" && req.method === "GET") {
    const cfg = credentialManager.getRedactedConfig();
    return Response.json({ success: true, groups: cfg.groups });
  }

  // POST /api/credentials/groups -- create group { name, members }
  if (path === "/api/credentials/groups" && req.method === "POST") {
    try {
      const body = await req.json() as { name: string; members: string[] };
      if (!body.name || !Array.isArray(body.members)) {
        return errorResponse("INPUT_VALIDATION_ERROR", "Missing 'name' or 'members' field", undefined, 400);
      }
      await credentialManager.addGroup(body.name, body.members);
      return Response.json({ success: true, message: `Group '${body.name}' created` }, { status: 201 });
    } catch (err) {
      if (err instanceof CredentialManagerError) {
        return errorResponse("INPUT_VALIDATION_ERROR", err.message, undefined, 400);
      }
      return errorResponse("INTERNAL_ERROR", err instanceof Error ? err.message : String(err));
    }
  }

  // PUT /api/credentials/groups/:name -- add members { members }
  const groupPutMatch = path.match(/^\/api\/credentials\/groups\/([^/]+)$/);
  if (groupPutMatch && req.method === "PUT") {
    try {
      const name = decodeURIComponent(groupPutMatch[1]!);
      const body = await req.json() as { members: string[] };
      if (!Array.isArray(body.members)) {
        return errorResponse("INPUT_VALIDATION_ERROR", "Missing 'members' field", undefined, 400);
      }
      await credentialManager.addGroupMembers(name, body.members);
      return Response.json({ success: true, message: `Members added to group '${name}'` });
    } catch (err) {
      if (err instanceof CredentialManagerError) {
        return errorResponse("INPUT_VALIDATION_ERROR", err.message, undefined, 400);
      }
      return errorResponse("INTERNAL_ERROR", err instanceof Error ? err.message : String(err));
    }
  }

  // DELETE /api/credentials/groups/:name -- remove group or members
  const groupDeleteMatch = path.match(/^\/api\/credentials\/groups\/([^/]+)$/);
  if (groupDeleteMatch && req.method === "DELETE") {
    try {
      const name = decodeURIComponent(groupDeleteMatch[1]!);
      let body: { members?: string[] } = {};
      try {
        body = await req.json() as { members?: string[] };
      } catch {
        const contentLength = req.headers.get("content-length");
        if (contentLength && contentLength !== "0") {
          return errorResponse("INPUT_VALIDATION_ERROR", "Malformed JSON body", undefined, 400);
        }
      }
      if (body.members && Array.isArray(body.members)) {
        await credentialManager.removeGroupMembers(name, body.members);
        return Response.json({ success: true, message: `Members removed from group '${name}'` });
      }
      await credentialManager.removeGroup(name);
      return Response.json({ success: true, message: `Group '${name}' removed` });
    } catch (err) {
      if (err instanceof CredentialManagerError) {
        return errorResponse("INPUT_VALIDATION_ERROR", err.message, undefined, 400);
      }
      return errorResponse("INTERNAL_ERROR", err instanceof Error ? err.message : String(err));
    }
  }

  // POST /api/credentials/reload -- reload from disk
  if (path === "/api/credentials/reload" && req.method === "POST") {
    try {
      await credentialManager.reloadFromDisk();
      return Response.json({ success: true, message: "Credentials reloaded" });
    } catch (err) {
      if (err instanceof CredentialManagerError) {
        return errorResponse("INPUT_VALIDATION_ERROR", err.message, undefined, 400);
      }
      return errorResponse("INTERNAL_ERROR", err instanceof Error ? err.message : String(err));
    }
  }

  return null;
}
