from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator

# ChatKit server + agents helpers
from chatkit.server import ChatKitServer, StreamingResult
from chatkit.types import (
    Event,
    ThreadMetadata,
    UserMessageItem,
    ClientToolCallOutputItem,
    FilePart,
    ImagePart,
    ResponseInputContentParam,
)
from chatkit.agents import (
    Agent,
    AgentContext,
    Runner,
    stream_agent_response,
    simple_to_agent_input,
)

# Dev-friendly storage backends provided by chatkit
from chatkit.store.sqlite import SQLiteStore
from chatkit.attachments.disk import DiskAttachmentStore


class MyChatKitServer(ChatKitServer):
    """Minimal ChatKit server integrated with the Agents SDK.

    Uses dev-grade SQLite + disk attachment storage. Suitable for local/dev and
    small deployments. For production, provide durable Store/AttachmentStore
    implementations backed by your database and blob storage.
    """

    def __init__(self, data_store: SQLiteStore, attachment_store: DiskAttachmentStore | None = None):
        super().__init__(data_store, attachment_store)

    # Simple default assistant. Customize model/instructions as needed.
    assistant_agent: Agent[AgentContext] = Agent[
        AgentContext
    ](
        model="gpt-4.1",
        name="Assistant",
        instructions="You are a helpful assistant for ad angles, headlines, and copies.",
    )

    async def respond(
        self,
        thread: ThreadMetadata,
        input: UserMessageItem | ClientToolCallOutputItem | None,
        context: Any,
    ) -> AsyncIterator[Event]:
        agent_context = AgentContext(
            thread=thread,
            store=self.store,
            request_context=context,
        )

        # Convert the incoming ChatKit item(s) into Agent SDK input.
        agent_input = await simple_to_agent_input(input) if input else []

        # Run the agent and stream the result back as ChatKit events.
        result = Runner.run_streamed(
            self.assistant_agent,
            agent_input,
            context=agent_context,
        )

        async for event in stream_agent_response(agent_context, result):
            yield event

    async def to_message_content(
        self, input: FilePart | ImagePart
    ) -> ResponseInputContentParam:
        # Optional: map uploaded attachments to Agent SDK input parts.
        # If you enable image/file uploads in the composer, implement this.
        raise NotImplementedError()


def build_default_server(db_path: str, files_dir: str) -> MyChatKitServer:
    """Factory to create a server with SQLite + disk attachments.

    - db_path: path to the SQLite file used by ChatKit's dev store
    - files_dir: base directory for storing uploaded attachment bytes
    """
    data_store = SQLiteStore(db_path)
    attachment_store = DiskAttachmentStore(base_dir=files_dir, store=data_store)
    return MyChatKitServer(data_store, attachment_store)


