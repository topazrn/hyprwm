export class Tile {
    id: number;
    isNew: boolean;
    
    constructor(id: number, isNew: boolean) {
        this.id = id;
        this.isNew = isNew;
    }
}

export class Container {
    split: "Horizontal" | "Vertical"
    // offset from center
    constraint?: number;

    constructor(split: "Horizontal" | "Vertical") {
        this.split = split;
    }
}