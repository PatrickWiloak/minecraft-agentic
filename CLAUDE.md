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
