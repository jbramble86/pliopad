# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-keepclassmembers class app.pliopad.** { *** Companion; }
-keepclasseswithmembers class app.pliopad.** { kotlinx.serialization.KSerializer serializer(...); }
