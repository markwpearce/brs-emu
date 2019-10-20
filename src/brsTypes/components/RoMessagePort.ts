import { BrsValue, ValueKind, BrsString, BrsInvalid, BrsBoolean } from "../BrsType";
import { BrsComponent } from "./BrsComponent";
import { RoUniversalControlEvent } from "./RoUniversalControlEvent";
import { BrsType } from "..";
import { Callable, StdlibArgument } from "../Callable";
import { Interpreter } from "../../interpreter";
import { Int32 } from "../Int32";
import { shared } from "../..";

export class RoMessagePort extends BrsComponent implements BrsValue {
    readonly kind = ValueKind.Object;
    private messageQueue: BrsType[];
    private keys: Int32Array;
    private lastKey: number;
    private screen: boolean;
    constructor() {
        super("roMessagePort", ["ifMessagePort"]);
        this.registerMethods([this.waitMessage, this.getMessage, this.peekMessage]);
        this.messageQueue = [];
        this.lastKey = 0;
        this.screen = false;
        let keys = shared.get("buffer");
        if (keys) {
            this.keys = keys;
        } else {
            this.keys = new Int32Array([]);
        }
    }

    enableKeys(enable: boolean) {
        this.screen = enable;
    }

    pushMessage(object: BrsType) {
        this.messageQueue.push(object);
    }

    toString(parent?: BrsType): string {
        return "<Component: roMessagePort>";
    }

    equalTo(other: BrsType) {
        return BrsBoolean.False;
    }

    wait(ms: number) {
        if (this.screen) {
            if (ms === 0) {
                while (true) {
                    if (this.keys[0] !== this.lastKey) {
                        this.lastKey = this.keys[0];
                        return new RoUniversalControlEvent(this.lastKey);
                    }
                }
            } else {
                let sec = Math.trunc(ms / 1000);
                ms += new Date().getTime();
                while (new Date().getTime() < ms) {
                    if (this.keys[0] !== this.lastKey) {
                        this.lastKey = this.keys[0];
                        return new RoUniversalControlEvent(this.lastKey);
                    }
                }
            }
        } else if (this.messageQueue.length > 0) {
            let message = this.messageQueue.shift();
            if (message) {
                return message;
            }
        }
        return BrsInvalid.Instance;
    }

    /** Waits until an event object is available or timeout milliseconds have passed. */
    private waitMessage = new Callable("waitMessage", {
        signature: {
            args: [new StdlibArgument("timeout", ValueKind.Int32)],
            returns: ValueKind.Dynamic,
        },
        impl: (_: Interpreter, timeout: Int32) => {
            return this.wait(timeout.getValue());
        },
    });

    /** If an event object is available, it is returned. Otherwise invalid is returned. */
    private getMessage = new Callable("getMessage", {
        signature: {
            args: [],
            returns: ValueKind.Dynamic,
        },
        impl: (_: Interpreter) => {
            if (this.screen) {
                if (this.keys[0] !== this.lastKey) {
                    this.lastKey = this.keys[0];
                    return new RoUniversalControlEvent(this.lastKey);
                }
            } else if (this.messageQueue.length > 0) {
                let message = this.messageQueue.shift();
                if (message) {
                    return message;
                }
            }
            return BrsInvalid.Instance;
        },
    });

    /** Similar to GetMessage() but the returned object (if not invalid) remains in the message queue. */
    private peekMessage = new Callable("peekMessage", {
        signature: {
            args: [],
            returns: ValueKind.Dynamic,
        },
        impl: (_: Interpreter) => {
            if (this.messageQueue.length > 0) {
                let message = this.messageQueue[0];
                if (message) {
                    return message;
                }
            }
            return BrsInvalid.Instance;
        },
    });
}
