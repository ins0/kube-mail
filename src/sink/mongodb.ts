import {Message, Query, RealtimeSink, RetrieveOptions, RetrieveResult} from "./interface";
import {CatchPolicy, SourceReference} from "../policy/provider";
import {TypedStream} from "../util";
import {Collection} from "mongodb";
import {Stream} from "stream";

const debug = require("debug")("kubemail:sink:mongodb");

export const mapLabelsForMongodb = (input: {[k: string]: string}): {[k:string]: string} => {
    const output: {[k:string]: string} = {};
    for (const k of Object.keys(input)) {
        const mapped = k.replace(".", "~");
        output[mapped] = input[k];
    }
    return output;
};

export class MongodbSink implements RealtimeSink {

    public constructor(private collection: Collection) {
    }

    public async setup(): Promise<void> {
        await this.collection.createIndex({"source.namespace": 1});
        await this.collection.createIndex({"expires": 1}, {expireAfterSeconds: 0});
        return;
    }

    public async storeMessage(source: SourceReference, message: Message, policy: CatchPolicy): Promise<void> {
        const sourceCopy = {...source};

        if (sourceCopy.labels !== undefined) {
            sourceCopy.labels = mapLabelsForMongodb(sourceCopy.labels);
        }

        const doc: any = {source: sourceCopy, ...message};

        if (policy.retention !== undefined) {
            doc.expires = new Date(new Date().getTime() + policy.retention * 86400000);
        }

        await this.collection.insertOne(doc);
        debug("stored message: %o", doc);
    }

    public async retrieveMessages(query: Query, opts?: RetrieveOptions): Promise<RetrieveResult> {
        const q: any = {"source.namespace": query.namespace};
        const {limit = 100, offset = 0} = opts || {};

        if (query.podName) {
            q["source.podName"] = query.podName;
        }

        if (query.labelSelector) {
            for (const k of Object.keys(query.labelSelector)) {
                const mapped = k.replace(".", "~");
                q[`source.labels.${mapped}`] = query.labelSelector[k];
            }
        }

        const totalCount = await this.collection.countDocuments(q, {});
        const messages = await this.collection.find(q).limit(limit).skip(offset).toArray();

        return {
            totalCount,
            messages,
        }
    }

    public retrieveMessageStream(query: Query): TypedStream<Message> {
        const stream = new Stream();

        setImmediate(() => {
            stream.emit("end");
        });

        return stream;
    }

}