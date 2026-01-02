// utils/cloudinary.js
const { v2: cloudinary } = require('cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function uploadBufferToCloudinary(
  buffer,
  { folder='farms', publicId, watermark=false, watermarkText='مزرعتي' } = {}
) {
  return new Promise((resolve, reject) => {

    const transformation = [
      { width: 1600, crop: "limit" },
      { quality: "auto" },
      { fetch_format: "auto" },
    ];

    // ✅ Watermark اختياري (شفاف)
    if (watermark) {
      transformation.push({
        overlay: {
          font_family: "Arial",     // لو ظهر مربعات جرّب خط يدعم العربية
          font_size: 78,
          font_weight: "bold",
          text: watermarkText
        },
        color: "#ffffff",
        opacity: 28,               // شفافية
        gravity: "south",     // أسفل يمين
        x: 0,
        y: 26,
    angle: -20
      });
    }

    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: 'image',
        transformation
      },
      (err, result) => err ? reject(err) : resolve(result)
    );

    stream.end(buffer);
  });
}

module.exports = { cloudinary, uploadBufferToCloudinary };
