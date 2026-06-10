# Minecraft Agentic Builder

AI agents that build Minecraft worlds autonomously while you watch.

## Requirements
- Minecraft Java Edition server (1.20.4)
- Online mode OFF
- Cheats enabled for `/setblock`

## Quick Start
```bash
# Run Minecraft server with Docker
docker run -d -p 25565:25565 -e EULA=TRUE -e ONLINE_MODE=FALSE -e ENABLE_COMMAND_BLOCK=TRUE itzg/minecraft-server:java21
```

## Status
Experimental/research project.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
