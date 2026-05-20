{{/*
_helpers.tpl — Junando Helm chart named templates
*/}}

{{/*
junando.fullname — Release-prefixed name, truncated to 63 characters.
Usage: {{ include "junando.fullname" . }}
*/}}
{{- define "junando.fullname" -}}
{{- printf "%s-junando" .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
junando.chart — Chart name + version label value.
Usage: {{ include "junando.chart" . }}
*/}}
{{- define "junando.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
junando.labels — Standard Kubernetes recommended labels.
Usage: {{ include "junando.labels" . | nindent 4 }}
*/}}
{{- define "junando.labels" -}}
helm.sh/chart: {{ include "junando.chart" . }}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
{{- end }}

{{/*
junando.selectorLabels — Minimal selector labels (name + instance).
Pass component via a context dict or call directly and add component separately.
Usage: {{ include "junando.selectorLabels" . | nindent 8 }}
*/}}
{{- define "junando.selectorLabels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
junando.serviceAccountName — Resolves the ServiceAccount name.
Returns .Values.serviceAccount.name if set, otherwise fullname.
Usage: {{ include "junando.serviceAccountName" . }}
*/}}
{{- define "junando.serviceAccountName" -}}
{{- if .Values.serviceAccount.name }}
{{- .Values.serviceAccount.name }}
{{- else }}
{{- include "junando.fullname" . }}
{{- end }}
{{- end }}
