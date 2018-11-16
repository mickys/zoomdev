"use strict";
/*

 * source       https://github.com/MCROEngineering/zoom/
 * @name        Zoom Core
 * @package     ZoomDev
 * @author      Micky Socaci <micky@mcro.tech>
 * @license     MIT
 
 based on https://github.com/ethereum/web3.js/blob/develop/lib/web3/httpprovider.js
*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ByteArray_1 = __importDefault(require("../utils/ByteArray"));
class Zoom {
    constructor() {
        this.calls = {};
        this.refcalls = {};
        this.binary = [];
    }
    buildCall(cache) {
        this.cache = cache;
        this.groupCalls();
        this.buildCallReferences();
        this.generateBinaryCalls();
        const binaryCall = this.getBinaryCall();
        return this.addZoomHeader(binaryCall);
    }
    addZoomHeader(data) {
        const bytes = new ByteArray_1.default(Buffer.alloc(2 + 2 + 2));
        // add version
        bytes.writeUnsignedShort(1);
        // add call num
        bytes.writeUnsignedShort(this.binary.length);
        // add expected return size
        // no longer required
        // bytes.writeUnsignedShort( this.getExpectedResultSizeInWords() );
        return bytes.toString("hex") + data;
    }
    getBinaryCall() {
        // make sure to sort these by type and have type 1 first, as we need to index them
        // in order to use the results for addresses / other things
        let data = "";
        for (let i = 0; i < this.binary.length; i++) {
            data += this.binary[i].toString("hex");
        }
        return data;
    }
    displayBinaryCalls() {
        for (let i = 0; i < this.binary.length; i++) {
            console.log("call:", i, this.binary[i].toString("hex"));
        }
    }
    getExpectedResultSizeInWords() {
        let len = 0;
        for (const key in this.cache) {
            if (this.cache.hasOwnProperty(key)) {
                len += this.cache[key].replace("0x", "").length;
            }
        }
        return Math.ceil((len / 2) / 32);
    }
    /*
    0x29e99f07
    0000000000000000000000000000000000000000000000000000000000000064
    0000000000000000000000000000000000000000000000000000000029e99f07

    - 1 byte uint8 call type ( 1 normal / 2 - to address is result of a previous call )
    00
    - 2 bytes uint16 call_data length
    0001
    - 2 bytes uint16 result_id that holds our call's address
    0001
    - 2 bytes uint16 offset in bytes where the address starts in said result
    0000
    - 20 bytes address / or none if type 2
    0000000000000000000000000000000000000099
    - 4 bytes method sha
    27285d5d
    | call data
    0000000000000000000000000000000000000000000000000000000000000060
    00000000000000000000000000000000000000000000000000000000000000a0
    00000000000000000000000000000000000000000000000000000000000000e0
    0000000000000000000000000000000000000000000000000000000000000001
    3100000000000000000000000000000000000000000000000000000000000000
    0000000000000000000000000000000000000000000000000000000000000001
    3200000000000000000000000000000000000000000000000000000000000000
    0000000000000000000000000000000000000000000000000000000000000001
    3300000000000000000000000000000000000000000000000000000000000000

    */
    generateBinaryCalls() {
        Object.keys(this.refcalls).forEach((key) => {
            const call = this.refcalls[key];
            for (let i = 0; i < call.values.length; i++) {
                if (call.values[i]) {
                    const currentCall = call.values[i];
                    const callData = Buffer.from(this.removeZeroX(currentCall), "hex");
                    const packet = {
                        type: 1,
                        data_length: callData.length,
                        result_id: 0,
                        offset: 0,
                        toAddress: Buffer.from(this.removeZeroX(key), "hex"),
                        data: callData,
                    };
                    // referenced calls
                    if (call.reference === true) {
                        packet.type = 2;
                        packet.toAddress = Buffer.from("");
                        packet.result_id = call.number.toString();
                        packet.offset = call.position.toString();
                    }
                    const bytes = new ByteArray_1.default(Buffer.alloc(8));
                    bytes.writeByte(packet.type);
                    bytes.writeUnsignedShort(packet.data_length);
                    bytes.writeUnsignedShort(packet.result_id);
                    bytes.writeUnsignedShort(packet.offset);
                    // 1 empty byte
                    bytes.writeByte(0);
                    bytes.copyBytes(packet.toAddress, 0);
                    bytes.copyBytes(callData, 0);
                    this.binary.push(bytes);
                    console.log(packet);
                }
            }
        });
    }
    parsePacket(bytes) {
        const packet = {
            type: 0,
            data_length: 0,
            result_id: 0,
            offset: 0,
            toAddress: "",
            data: "",
        };
        let offset = 0;
        packet.type = bytes.readInt8(offset);
        offset += 2;
        packet.data_length = bytes.readInt16BE(offset);
        offset += 2;
        packet.result_id = bytes.readInt16BE(offset);
        offset += 2;
        packet.offset = bytes.readInt16BE(offset);
        offset += 2;
        // packet.toAddress = bytes.readInt16BE(offset);
    }
    removeZeroX(string) {
        return string.replace("0x", "");
    }
    toPaddedWord(num, size = 32) {
        return this.addZeros(num, size);
    }
    addZeros(num, size) {
        let s = num + "";
        while (s.length < size) {
            s += "0";
        }
        return s;
    }
    groupCalls() {
        Object.keys(this.cache).forEach((key) => {
            const parts = key.split("_");
            const toAddress = parts[0];
            const toCall = parts[1];
            if (!this.calls.hasOwnProperty(toAddress)) {
                this.calls[toAddress] = [];
            }
            this.calls[toAddress].push(toCall);
        });
    }
    buildCallReferences() {
        Object.keys(this.calls).forEach((key) => {
            const { found, callNum, bytePosition } = this.findToAddressInAResult(key);
            if (found === true) {
                this.refcalls[key] = {
                    reference: found,
                    number: callNum,
                    position: bytePosition,
                    values: this.calls[key],
                };
            }
            else {
                this.refcalls[key] = {
                    reference: found,
                    values: this.calls[key],
                };
            }
        });
    }
    findToAddressInAResult(to) {
        // strip 0x from the address
        const cleanTo = to.replace("0x", "");
        const retval = {
            callNum: 0,
            bytePosition: 0,
            found: false,
        };
        Object.keys(this.cache).some((key, index) => {
            const position = this.cache[key].indexOf(cleanTo);
            if (position > -1) {
                retval.callNum = index;
                retval.bytePosition = (position - 2) / 2; // adjust for 0x in result
                retval.found = true;
                return true;
            }
            return false;
        });
        return retval;
    }
}
exports.default = Zoom;
;
//# sourceMappingURL=core.js.map