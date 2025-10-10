const mongoose=require('mongoose');
const { Student}=require('./Student');
const {Course}=require('./Course');
const SectionSchema=new mongoose.Schema({
    SectionName:{type:'String',required:true},
Student: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student'
}],
attendece: { type: Boolean, default: false },
Teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
Course: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course'
}],
RoomNo: { type: 'String', required: true },
Day: { type: [String], required: true },
Timming: { type: 'String', required: true },
completed: { type: Boolean, default: false }

}, { timestamps: true });
export const Section=mongoose.model('Section',SectionSchema);
// which section