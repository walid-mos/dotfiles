# Workers VPC Connectivity

Connect Cloudflare Workers to private networks and internal infrastructure using TCP Sockets.

## Overview

Workers VPC connectivity enables outbound TCP connections from Workers to private resources in AWS, Azure, GCP, on-premises datacenters, or any private network. This is achieved through the **TCP Sockets API** (`cloudflare:sockets`), which provides low-level network access for custom protocols and services.

**Key capabilities:**
- Direct TCP connections to private IPs and hostnames
- TLS/StartTLS support for encrypted connections
- Integration with Cloudflare Tunnel for secure private network access
- Full control over wire protocols (database protocols, SSH, MQTT, custom TCP)

**Note:** This reference documents the TCP Sockets API. For the newer Workers VPC Services product (HTTP-only service bindings with built-in SSRF protection), refer to separate documentation when available. VPC Services is currently in beta (2025+).

## Quick Decision: Which Technology?

Need private network connectivity from Workers?

| Requirement | Use | Why |
|------------|-----|-----|
| HTTP/HTTPS APIs in private network | VPC Services (beta, separate docs) | SSRF-safe, declarative bindings |
| PostgreSQL/MySQL databases | [Hyperdrive](../hyperdrive/) | Connection pooling, caching, optimized |
| Custom TCP protocols (SSH, MQTT, proprietary) | **TCP Sockets (this doc)** | Full protocol control |
| Simple HTTP with lowest latency | TCP Sockets + [Smart Placement](../smart-placement/) | Manual optimization |
| Expose on-prem to internet (inbound) | [Cloudflare Tunnel](../tunnel/) | Not Worker-specific |

## When to Use TCP Sockets

**Use TCP Sockets when you need:**
- ✅ Direct control over wire protocols (e.g., Postgres wire protocol, SSH, Redis RESP)
- ✅ Non-HTTP protocols (MQTT, SMTP, custom binary protocols)
- ✅ StartTLS or custom TLS negotiation
- ✅ Streaming binary data over TCP

**Don't use TCP Sockets when:**
- ❌ You just need HTTP/HTTPS (use `fetch()` or VPC Services)
- ❌ You need PostgreSQL/MySQL (use Hyperdrive for pooling)
- ❌ You need WebSocket (use native Workers WebSocket)

## Quick Start

```typescript
import { connect } from 'cloudflare:sockets';

export default {
  async fetch(req: Request): Promise<Response> {
    // Connect to private service
    const socket = connect(
      { hostname: "db.internal.company.net", port: 5432 },
      { secureTransport: "on" }
    );

    try {
      await socket.opened; // Wait for connection
      
      const writer = socket.writable.getWriter();
      await writer.write(new TextEncoder().encode("QUERY\r\n"));
      await writer.close();

      const reader = socket.readable.getReader();
      const { value } = await reader.read();
      
      return new Response(value);
    } finally {
      await socket.close();
    }
  }
};
```

## Private Networks and Tunnel

> **Unverified path — do not copy as-is.** An ordinary Worker TCP socket to a Tunnel hostname on a private service is not an established supported route: a public Tunnel hostname does not by itself make the private TCP endpoint reachable from a Worker, and this reference has no verified Cloudflare-documented Workers-to-private-service path over TCP. For HTTP/HTTPS services in a private network, use **Workers VPC Services** (HTTP service bindings with built-in SSRF protection) or route through an origin proxy that is itself publicly reachable. For databases, prefer [Hyperdrive](../hyperdrive/). Verify the current supported connectivity options in official Cloudflare documentation before building on any Tunnel-based route.

For detailed Tunnel setup (for inbound traffic exposure, unrelated to Worker egress), see the [Tunnel configuration reference](../tunnel/configuration.md).

## Reading Order

1. **Start here (README.md)** - Overview and decision guide
2. **[api.md](./api.md)** - Socket interface, types, methods
3. **[configuration.md](./configuration.md)** - Wrangler setup, Tunnel integration
4. **[patterns.md](./patterns.md)** - Real-world examples (databases, protocols, error handling)
5. **[gotchas.md](./gotchas.md)** - Limits, blocked ports, common errors

## Key Limits

| Limit | Value |
|-------|-------|
| Max concurrent sockets per request | 6 |
| Blocked destinations | Cloudflare IPs, localhost, port 25 |
| Scope requirement | Must create in handler (not global) |

See [gotchas.md](./gotchas.md) for complete limits and troubleshooting.

## Best Practices

1. **Always close sockets** - Use try/finally blocks
2. **Validate destinations** - Prevent SSRF by allowlisting hosts
3. **Use Hyperdrive for databases** - Better performance than raw TCP
4. **Prefer fetch() for HTTP** - Only use TCP when necessary
5. **Combine with Smart Placement** - Reduce latency to private networks

## Related Technologies

- **[Hyperdrive](../hyperdrive/)** - PostgreSQL/MySQL with connection pooling
- **[Cloudflare Tunnel](../tunnel/)** - Secure private network access
- **[Smart Placement](../smart-placement/)** - Auto-locate Workers near backends
- **VPC Services (beta)** - HTTP-only service bindings with SSRF protection (separate docs)

## Reference

- [TCP Sockets API Documentation](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- [Connect to databases guide](https://developers.cloudflare.com/workers/tutorials/postgres/)
- [Cloudflare Tunnel setup](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
