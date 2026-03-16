import tpye{ Panel, Point2D, JointConfig} from '../models/type';

export interface TabSpec{
    count: number;
    tabWidth: number;
    gabWidth: number;
}

export function computeTabSpec(
    edgeLength: number;
    mathThickness: number;
    config JointConfig;
); TabSpec;

const minTabWidth = matThickness * 1.5;

if(config.tabWidthOverride > 0){
    const 
}