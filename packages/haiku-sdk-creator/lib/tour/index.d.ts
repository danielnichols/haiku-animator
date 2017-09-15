export interface Tour {
    next(): MaybeAsync<void>;
    start(options?: object): MaybeAsync<void>;
    notifyScreenResize(): MaybeAsync<void>;
    receiveElementCoordinates(webview: string, position: ClientBoundingRect): MaybeAsync<void>;
    receiveWebviewCoordinates(webview: string, coordinates: ClientBoundingRect): MaybeAsync<void>;
}
export interface TourState {
    selector: string;
    webview: string;
    component: string;
    display: string;
    offset: ClientBoundingRect;
    spotlightRadius: number | string;
}
export interface ClientBoundingRect {
    top: number | string;
    left: number | string;
}
export declare type MaybeAsync<T> = T | Promise<T>;
export * from "./tour";
