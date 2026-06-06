from typing import Literal

from pydantic import BaseModel

# Frontend → sidecar commands.


class PingCommand(BaseModel):
    type: Literal["ping"]


# Sidecar → frontend events.


class PongEvent(BaseModel):
    type: Literal["pong"]
