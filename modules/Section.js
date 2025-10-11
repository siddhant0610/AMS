const mongoose=require('mongoose');
const { Student}=require('./Student');
const {Course}=require('./Course');
// const {Teacher}=require('./Teacher');
import mongooseAggregatePaginate from 'mongoose-aggregate-paginate';
const SectionSchema=new mongoose.Schema({
    SectionName:{type:'String',required:true},
   Student: [
    {
      Reg_No: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
      },
      attendance: {
        type: Boolean,
        default: false
      }
    }
  ],
    Course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course'
},
    // attendece: { type: Boolean, default: false },
    Teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },// who teaches a particular section and a particular subject
   
    RoomNo: { type: 'String', required: true },
    Day: { type: String, enum:['Monday','Tuesday','Wednesday','Thursday','Friday'], required: true },
    startTime: {
        type: String, // e.g., "10:00"
        required: true
    },
    endTime: {
        type: String, // e.g., "11:00"
        required: true
    },
    completed: { type: Boolean, default: false }

}, { timestamps: true });
SectionSchema.plugin(mongooseAggregatePaginate);
export const Section=mongoose.model('Section',SectionSchema);
