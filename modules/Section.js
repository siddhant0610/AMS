const mongoose=require('mongoose');
const { Student}=require('./Student');
const {Course}=require('./Course');
const SectionSchema=new mongoose.Schema({
    SectionName:{type:'String',required:true},
    Student:[{ type:mongoose.Schema.Types.ObjectId,
    ref:'Student',
    }],
    Course:[{type:mongoose.Schema.Types.ObjectId,
        ref:'Course',
    }],
    RoomNo:{type:'String',required:true},
    Date:{type:'String',required:true},
    Timming:{type:'String',required:true},
    completed:{type:Boolean,default:false}
});
export const Section=mongoose.model('Section',SectionSchema);
// which section