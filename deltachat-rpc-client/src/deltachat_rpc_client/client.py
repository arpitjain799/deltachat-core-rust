"""Event loop implementations offering high level event handling/hooking."""
import logging
from typing import Callable, Dict, Iterable, Optional, Set, Tuple, Type, Union

from deltachat_rpc_client.account import Account

from .const import EventType
from .events import EventFilter, NewInfoMessage, NewMessage, RawEvent
from .utils import AttrDict


class Client:
    """Simple Delta Chat client that listen to events of a single account."""

    def __init__(
        self,
        account: Account,
        hooks: Optional[Iterable[Tuple[Callable, Union[type, EventFilter]]]] = None,
        logger: Optional[logging.Logger] = None,
    ) -> None:
        self.account = account
        self.logger = logger or logging
        self._hooks: Dict[type, Set[tuple]] = {}
        self.add_hooks(hooks or [])

    def add_hooks(
        self, hooks: Iterable[Tuple[Callable, Union[type, EventFilter]]]
    ) -> None:
        for hook, event in hooks:
            self.add_hook(hook, event)

    def add_hook(
        self, hook: Callable, event: Union[type, EventFilter] = RawEvent
    ) -> None:
        """Register hook for the given event filter."""
        if isinstance(event, type):
            event = event()
        assert isinstance(event, EventFilter)
        self._hooks.setdefault(type(event), set()).add((hook, event))

    def remove_hook(self, hook: Callable, event: Union[type, EventFilter]) -> None:
        """Unregister hook from the given event filter."""
        if isinstance(event, type):
            event = event()
        self._hooks.get(type(event), set()).remove((hook, event))

    async def is_configured(self) -> bool:
        return await self.account.is_configured()

    async def configure(self, email: str, password: str, **kwargs) -> None:
        await self.account.set_config("addr", email)
        await self.account.set_config("mail_pw", password)
        for key, value in kwargs.items():
            await self.account.set_config(key, value)
        await self.account.configure()
        self.logger.debug("Account configured")

    async def run_forever(self) -> None:
        self.logger.debug("Listening to incoming events...")
        if await self.is_configured():
            await self.account.start_io()
        await self._process_messages()  # Process old messages.
        while True:
            event = await self.account.wait_for_event()
            event["type"] = EventType(event.type)
            event["account"] = self.account
            await self._on_event(event)
            if event.type == EventType.INCOMING_MSG:
                await self._process_messages()

    async def _on_event(
        self, event: AttrDict, filter_type: Type[EventFilter] = RawEvent
    ) -> None:
        for hook, evfilter in self._hooks.get(filter_type, []):
            if await evfilter.filter(event):
                try:
                    await hook(event)
                except Exception as ex:
                    self.logger.exception(ex)

    def _should_process_messages(self) -> bool:
        return any(issubclass(filter_type, NewMessage) for filter_type in self._hooks)

    async def _process_messages(self) -> None:
        if self._should_process_messages():
            for message in await self.account.get_fresh_messages_in_arrival_order():
                snapshot = await message.get_snapshot()
                if snapshot.is_info:
                    await self._on_event(snapshot, NewInfoMessage)
                else:
                    await self._on_event(snapshot, NewMessage)
                await snapshot.message.mark_seen()


class Bot(Client):
    """Simple bot implementation that listent to events of a single account."""

    async def configure(self, email: str, password: str, **kwargs) -> None:
        kwargs.setdefault("bot", "1")
        await super().configure(email, password, **kwargs)
